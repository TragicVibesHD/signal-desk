$ErrorActionPreference = 'Stop'
$projectDirectory = $PSScriptRoot
$appUrl = 'http://127.0.0.1:4317'
function Test-SignalDesk {
    try {
        $snapshot = Invoke-RestMethod "$appUrl/api/state" -TimeoutSec 2
        return $snapshot.paper.endpoint -eq 'Alpaca paper only'
    } catch { return $false }
}
if (-not (Test-SignalDesk)) {
    $nodeExecutable = (Get-Command node -ErrorAction Stop).Source
    Start-Process -FilePath $nodeExecutable -ArgumentList 'server.mjs' -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectDirectory 'server.log') -RedirectStandardError (Join-Path $projectDirectory 'server-error.log') | Out-Null
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 300
        if (Test-SignalDesk) { $ready = $true; break }
    }
    if (-not $ready) { throw 'Signal Desk did not start. Check server-error.log in this folder.' }
}
Start-Process "$appUrl/#paper"
Write-Host 'Signal Desk is running in the background. Connect your PAPER keys in the app and check that the dated session says ARMED.'
Write-Host 'Keep this PC plugged in, awake and online through the market close. The browser can be closed.'
