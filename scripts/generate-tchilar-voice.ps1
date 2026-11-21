Add-Type -AssemblyName System.Speech
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$manifestPath = Join-Path $taskRoot 'tmp/video/narration.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speaker.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::NotSet, [System.Speech.Synthesis.VoiceAge]::NotSet, 0, [System.Globalization.CultureInfo]'pt-PT')
if ($speaker.Voice.Culture.Name -notlike 'pt-*') { throw 'A voz portuguesa não está selecionada.' }
$speaker.Rate = 0
$speaker.Volume = 92
foreach ($scene in $manifest) {
    $speaker.SetOutputToWaveFile($scene.audio)
    $speaker.Speak($scene.text)
    $speaker.SetOutputToNull()
}
$speaker.Dispose()
Write-Output "Narração gerada com voz portuguesa em $($manifest.Count) segmentos."
