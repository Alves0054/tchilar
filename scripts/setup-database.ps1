$ErrorActionPreference = "Stop"
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$psql = Get-Command psql -ErrorAction SilentlyContinue
if ($psql) {
  $psqlPath = $psql.Source
} else {
  $psqlPath = Get-ChildItem -LiteralPath "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName "bin\psql.exe" } |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1
}
if ([string]::IsNullOrWhiteSpace($psqlPath) -or -not (Test-Path -LiteralPath $psqlPath)) {
  throw "psql não encontrado. Instala PostgreSQL 17 ou adiciona psql ao PATH."
}

$envPath = Join-Path $workspaceRoot ".env"
$examplePath = Join-Path $workspaceRoot ".env.example"
if (Test-Path -LiteralPath $envPath) {
  throw ".env já existe. Não foi alterado; preserva a configuração existente."
}
if (-not (Test-Path -LiteralPath $examplePath)) {
  throw ".env.example não foi encontrado."
}

$hostName = Read-Host "Servidor PostgreSQL [localhost]"
if ([string]::IsNullOrWhiteSpace($hostName)) { $hostName = "localhost" }
$portInput = Read-Host "Porta PostgreSQL [5432]"
$port = 5432
if (-not [string]::IsNullOrWhiteSpace($portInput)) {
  if (-not [int]::TryParse($portInput, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
    throw "Porta PostgreSQL inválida."
  }
}
$adminUser = Read-Host "Utilizador administrador PostgreSQL [postgres]"
if ([string]::IsNullOrWhiteSpace($adminUser)) { $adminUser = "postgres" }
$adminPassword = Read-Host "Palavra-passe do administrador PostgreSQL" -AsSecureString
$adminPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminPassword)
$previousPassword = $env:PGPASSWORD
try {
  $plainAdminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($adminPointer)
  $generated = node -e "const c=require('crypto'); console.log(c.randomBytes(48).toString('hex')); console.log(c.randomBytes(32).toString('base64url'))"
  if ($LASTEXITCODE -ne 0) { throw "Não foi possível gerar segredos locais com Node.js." }
  $generatedLines = $generated -split "`r?`n"
  $jwtSecret = $generatedLines[0].Trim()
  $databasePassword = $generatedLines[1].Trim()
  $sqlPassword = $databasePassword.Replace("'", "''")

  $env:PGPASSWORD = $plainAdminPassword
  $roleSql = "DO `$setup`$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='biva') THEN CREATE ROLE biva LOGIN PASSWORD '$sqlPassword'; ELSE ALTER ROLE biva WITH LOGIN PASSWORD '$sqlPassword'; END IF; END `$setup`$;"
  & $psqlPath -X -w -v ON_ERROR_STOP=1 -h $hostName -p $port -U $adminUser -d postgres -c $roleSql
  if ($LASTEXITCODE -ne 0) { throw "Não foi possível criar o utilizador da aplicação. Confirma os dados de administrador." }

  $databaseExists = & $psqlPath -X -w -v ON_ERROR_STOP=1 -h $hostName -p $port -U $adminUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='biva'"
  if ($LASTEXITCODE -ne 0) { throw "Não foi possível verificar a base de dados." }
  if (($databaseExists -join "").Trim() -ne "1") {
    & $psqlPath -X -w -v ON_ERROR_STOP=1 -h $hostName -p $port -U $adminUser -d postgres -c "CREATE DATABASE biva OWNER biva"
    if ($LASTEXITCODE -ne 0) { throw "Não foi possível criar a base de dados biva." }
  } else {
    & $psqlPath -X -w -v ON_ERROR_STOP=1 -h $hostName -p $port -U $adminUser -d postgres -c "ALTER DATABASE biva OWNER TO biva"
    if ($LASTEXITCODE -ne 0) { throw "Não foi possível atualizar o proprietário da base de dados." }
  }

  $env:PGPASSWORD = $databasePassword
  $connectionTest = & $psqlPath -X -w -v ON_ERROR_STOP=1 -h $hostName -p $port -U biva -d biva -tAc "SELECT 1"
  if ($LASTEXITCODE -ne 0 -or ($connectionTest -join "").Trim() -ne "1") {
    throw "A conta da aplicação não conseguiu ligar à base de dados."
  }

  $databaseHost = $hostName
  if ($databaseHost -eq "localhost") { $databaseHost = "127.0.0.1" }
  $databaseUrl = "postgresql://biva:$databasePassword@$databaseHost`:$port/biva"
  $content = Get-Content -LiteralPath $examplePath -Raw
  $content = $content.Replace("replace_with_a_random_secret_at_least_32_characters", $jwtSecret)
  $content = $content.Replace("replace_with_a_random_password", $databasePassword)
  $content = [regex]::Replace($content, "^DATABASE_URL=.*$", "DATABASE_URL=$databaseUrl", [Text.RegularExpressions.RegexOptions]::Multiline)
  [IO.File]::WriteAllText($envPath, $content, [Text.UTF8Encoding]::new($false))
  Write-Host "Base de dados biva criada e ligação verificada."
  Write-Host "Configuração local criada em .env. Não partilhes esse ficheiro."
  Write-Host "Arranca a aplicação com: npm run dev"
} finally {
  if ($null -eq $previousPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  else { $env:PGPASSWORD = $previousPassword }
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminPointer)
  $adminPassword.Dispose()
  $plainAdminPassword = $null
  $databasePassword = $null
}
