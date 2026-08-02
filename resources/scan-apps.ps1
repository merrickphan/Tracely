<#
  One-shot scan of Windows' installed-programs registry data (the same
  source Windows Settings > Apps reads) so Settings can show a blocklist
  checklist of real apps on this machine instead of a generic list.

  Registry entries don't reliably point at the app's actual .exe:
  DisplayIcon frequently points at Uninstaller.exe instead of the real
  binary (confirmed empirically against a live machine — e.g. "Google Play
  Games" -> Uninstaller.exe), so falls back to scanning InstallLocation for
  the largest non-uninstaller/non-helper .exe. Entries that still can't be
  resolved to a real, existing .exe are dropped rather than shown wrong —
  the Preferences UI's manual "add by .exe name" field is the fallback for
  anything this heuristic misses or gets wrong. Also drops obvious non-app
  noise (redistributables, runtimes, drivers, system components).

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

function Resolve-AppExe($displayIcon, $installLocation) {
  if ($displayIcon) {
    $iconPath = ($displayIcon -split ',')[0].Trim('"')
    if (
      $iconPath -match '(?i)\.exe$' -and
      $iconPath -notmatch '(?i)unins|setup\.exe$|remove\w*\.exe$' -and
      (Test-Path $iconPath -ErrorAction SilentlyContinue)
    ) {
      return $iconPath
    }
  }
  if ($installLocation -and (Test-Path $installLocation -ErrorAction SilentlyContinue)) {
    $exes = Get-ChildItem -Path $installLocation -Filter *.exe -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -notmatch '(?i)unins|setup|update|helper|crashpad|elevate|vc_redist|remove' }
    if ($exes) {
      return ($exes | Sort-Object Length -Descending | Select-Object -First 1).FullName
    }
  }
  return $null
}

try {
  $noisePattern = '(?i)redistributable|runtime|framework|build tools|driver|device control service|' +
    'genuine service|documentation|connection optimizer|one agent|advisor|sdk$'

  $keys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )

  $seen = New-Object System.Collections.Generic.HashSet[string]
  $apps = @()

  foreach ($keyPattern in $keys) {
    Get-ItemProperty -Path $keyPattern -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.DisplayName -and -not $_.SystemComponent -and -not $_.ParentKeyName -and $_.DisplayName -notmatch $noisePattern) {
        $exePath = Resolve-AppExe $_.DisplayIcon $_.InstallLocation
        if ($exePath) {
          $exeName = [System.IO.Path]::GetFileName($exePath)
          if ($seen.Add($exeName.ToLower())) {
            $apps += [PSCustomObject]@{ name = $_.DisplayName; exe = $exeName }
          }
        }
      }
    }
  }

  Write-Result @{ ok = $true; apps = @($apps) }
} catch {
  Write-Result @{ ok = $false; error = $_.Exception.Message }
}
