<#
  One-shot scan of Start Menu shortcuts (per-user + all-users) to find which
  known writing/document apps are actually installed, so Settings can show
  a blocklist checklist reflecting this machine instead of a generic list.
  Resolves each .lnk's target and returns the unique set of exe basenames
  found — matching against the candidate list happens on the Node side.

  Always prints exactly one line of JSON to stdout and exits.
#>
$ErrorActionPreference = 'Stop'

$stdout = [Console]::OpenStandardOutput()
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Result($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 4
  $bytes = $utf8NoBom.GetBytes($json + "`n")
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}

try {
  $folders = @(
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
    (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs')
  )

  $shell = New-Object -ComObject WScript.Shell
  $found = New-Object System.Collections.Generic.HashSet[string]

  foreach ($folder in $folders) {
    if (-not (Test-Path $folder)) { continue }
    $links = Get-ChildItem -Path $folder -Recurse -Filter *.lnk -ErrorAction SilentlyContinue
    foreach ($link in $links) {
      try {
        $shortcut = $shell.CreateShortcut($link.FullName)
        $target = $shortcut.TargetPath
        if ($target -and $target.ToLower().EndsWith('.exe')) {
          $exeName = [System.IO.Path]::GetFileName($target)
          [void]$found.Add($exeName)
        }
      } catch {}
    }
  }

  Write-Result @{ ok = $true; apps = @($found) }
} catch {
  Write-Result @{ ok = $false; error = $_.Exception.Message }
}
