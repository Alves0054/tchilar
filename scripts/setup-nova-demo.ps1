$ErrorActionPreference = "Stop"

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$bin = "C:\Program Files\PostgreSQL\17\bin"
$initdb = Join-Path $bin "initdb.exe"
$pgCtl = Join-Path $bin "pg_ctl.exe"
$psql = Join-Path $bin "psql.exe"
$pgIsReady = Join-Path $bin "pg_isready.exe"
$dataRoot = Join-Path $env:LOCALAPPDATA "NOVAPlus\PostgreSQL17"
$dataPath = Join-Path $dataRoot "data"
$logPath = Join-Path $dataRoot "postgres.log"
$passwordFile = Join-Path $dataRoot "init-password.tmp"
$envPath = Join-Path $workspaceRoot ".env"
$examplePath = Join-Path $workspaceRoot ".env.example"
$port = 5433
$previousPassword = $env:PGPASSWORD

foreach ($executable in @($initdb, $pgCtl, $psql, $pgIsReady)) {
  if (-not (Test-Path -LiteralPath $executable)) {
    throw "Ferramenta PostgreSQL não encontrada: $executable"
  }
}
if (-not (Test-Path -LiteralPath $examplePath)) {
  throw ".env.example não foi encontrado."
}
if (Test-Path -LiteralPath $envPath) {
  throw ".env ja existe e foi preservado. Nao foi alterado."
}
if (Test-Path -LiteralPath $dataRoot) {
  throw "A pasta de demonstracao ja existe. Nao foi apagada nem reutilizada: $dataRoot"
}
if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
  throw "A porta local $port ja esta ocupada. Nenhuma base de dados foi alterada."
}

New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
$secrets = & node -e "const c=require('crypto'); console.log(c.randomBytes(32).toString('hex')); console.log(c.randomBytes(32).toString('hex'))"
if ($LASTEXITCODE -ne 0 -or $secrets.Count -ne 2) {
  throw "Nao foi possivel gerar credenciais locais."
}
$adminPassword = $secrets[0].Trim()
$databasePassword = $secrets[1].Trim()
$sqlPassword = $databasePassword

try {
  Set-Content -LiteralPath $passwordFile -Value $adminPassword -NoNewline -Encoding Ascii
  & $initdb -D $dataPath -U nova_local_admin --pwfile=$passwordFile --auth=scram-sha-256 --encoding=UTF8 --no-locale
  if ($LASTEXITCODE -ne 0) {
    throw "Nao foi possivel inicializar a base de dados local isolada."
  }

  & $pgCtl -D $dataPath -l $logPath -o "-h 127.0.0.1 -p $port" -w -t 30 start
  if ($LASTEXITCODE -ne 0) {
    throw "Nao foi possivel iniciar o PostgreSQL local."
  }

  $env:PGPASSWORD = $adminPassword
  & $psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $port -U nova_local_admin -d postgres -c "CREATE ROLE creator_social LOGIN PASSWORD '$sqlPassword'"
  if ($LASTEXITCODE -ne 0) {
    throw "Nao foi possivel criar o utilizador local da aplicacao."
  }
  & $psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $port -U nova_local_admin -d postgres -c "CREATE DATABASE creator_social OWNER creator_social"
  if ($LASTEXITCODE -ne 0) {
    throw "Nao foi possivel criar a base de dados local da aplicacao."
  }

  $env:PGPASSWORD = $databasePassword
  $connection = & $psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $port -U creator_social -d creator_social -tAc "SELECT 1"
  if ($LASTEXITCODE -ne 0 -or ($connection -join "").Trim() -ne "1") {
    throw "Nao foi possivel verificar a ligacao a base de dados local."
  }

  $jwtSecret = & node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($jwtSecret)) {
    throw "Nao foi possivel gerar o segredo local da aplicacao."
  }
  $content = Get-Content -LiteralPath $examplePath -Raw
  $content = $content.Replace("replace_with_a_random_secret_at_least_32_characters", $jwtSecret.Trim())
  $content = $content.Replace("replace_with_a_random_password", $databasePassword)
  $databaseUrl = "postgresql://creator_social:$databasePassword@127.0.0.1:$port/creator_social"
  $content = [regex]::Replace($content, "^DATABASE_URL=.*$", "DATABASE_URL=$databaseUrl", [Text.RegularExpressions.RegexOptions]::Multiline)
  [IO.File]::WriteAllText($envPath, $content, [Text.UTF8Encoding]::new($false))

  Push-Location $workspaceRoot
  try {
    & npm.cmd run db:seed-demo
    if ($LASTEXITCODE -ne 0) {
      throw "A base de dados ficou pronta, mas nao foi possivel criar o perfil de demonstracao."
    }
  } finally {
    Pop-Location
  }

  Write-Host "Base de dados NOVA+ pronta. A instancia anterior do PostgreSQL nao foi alterada."
  Write-Host "Podes iniciar os servicos com a tarefa 'Iniciar NOVA+ (frontend + API)'."
} finally {
  if (Test-Path -LiteralPath $passwordFile) {
    Remove-Item -LiteralPath $passwordFile -Force
  }
  if ($null -eq $previousPassword) {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  } else {
    $env:PGPASSWORD = $previousPassword
  }
  $adminPassword = $null
  $databasePassword = $null
}
