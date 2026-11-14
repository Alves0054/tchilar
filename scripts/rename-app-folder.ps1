# Muda a pasta da app de mobile/biva-expo para mobile/tchilar-app e atualiza as referências.
# Fecha antes o editor de código (VS Code, Cursor...) e o Expo: o Windows não deixa mudar o nome
# de uma pasta que outro programa tem aberta.
# Uso (na raiz do projeto):  powershell -ExecutionPolicy Bypass -File scripts/rename-app-folder.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Test-Path "mobile/biva-expo")) { Write-Host "A pasta já se chama mobile/tchilar-app."; exit 0 }
git mv mobile/biva-expo mobile/tchilar-app
$files = git grep -l "biva-expo" -- . ":!package-lock.json"
foreach ($file in $files) {
  $text = [IO.File]::ReadAllText((Resolve-Path $file))
  [IO.File]::WriteAllText((Resolve-Path $file), $text.Replace("mobile/biva-expo", "mobile/tchilar-app").Replace("biva-expo", "tchilar-app"), (New-Object Text.UTF8Encoding $false))
}
Write-Host "Feito: a app está em mobile/tchilar-app."
