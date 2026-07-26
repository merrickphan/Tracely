<#
  One-shot UI Automation snapshot of the currently focused text field, used
  by Tracely's Screen Watch feature. Invoked fresh on every poll tick by the
  Electron main process (see src/main/services/screenWatch) rather than kept
  running as a persistent process, to avoid the complexity/fragility of
  async stdin command handling in PowerShell.

  Params:
    -SpansB64        base64 of a JSON array of {id, start, length} character
                     offsets to fetch bounding rectangles for, or empty.
                     Offsets are resolved by position, not by text search —
                     the Node side locates claims within the text itself
                     (shared/claimSpans.ts, the same fuzzy matching the Live
                     tab uses) because the AI's "claim text" is frequently
                     NOT an exact substring of the source despite the
                     detection prompt asking for a verbatim quote — models
                     don't reliably comply for claims that are natural
                     paraphrases of surrounding context. UIA's FindText only
                     does exact (case-insensitive) substring search with no
                     fuzzy matching, so search-by-text silently returned zero
                     matches for most real claims — confirmed by direct
                     comparison against live document text during
                     development, not a hypothetical.
    -SelfProcessName the app's own process image name (e.g. "Tracely.exe"),
                     so focus inside Tracely's own windows is ignored rather
                     than fed back into itself.

  Always prints exactly one line of JSON to stdout and exits.
#>
param(
  [string]$SpansB64 = "",
  [string]$SelfProcessName = "Tracely.exe"
)

$ErrorActionPreference = 'Stop'

# PowerShell's console stdout encoding is inconsistent across Windows/PS
# versions (often UTF-16LE or the system codepage) and Node reads the pipe
# assuming UTF-8, which silently corrupts any non-ASCII character (smart
# quotes, accents, em-dashes — all common in real writing) into invalid JSON.
# Writing raw UTF-8 bytes directly bypasses PowerShell's own encoding layer.
$stdout = [Console]::OpenStandardOutput()
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Result($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 8
  $bytes = $utf8NoBom.GetBytes($json + "`n")
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}

try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
} catch {
  Write-Result @{ ok = $false; error = "UIAutomation assemblies unavailable: $($_.Exception.Message)" }
  exit 0
}

try {
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -eq $focused) {
    Write-Result @{ ok = $true; skip = $true; reason = "no-focused-element" }
    exit 0
  }

  $processName = "unknown"
  try {
    $proc = Get-Process -Id $focused.Current.ProcessId -ErrorAction Stop
    $processName = "$($proc.ProcessName).exe"
  } catch {}

  if ($processName -ieq $SelfProcessName) {
    Write-Result @{ ok = $true; skip = $true; reason = "self" }
    exit 0
  }

  $rect = $focused.Current.BoundingRectangle
  $controlRect = @{ x = $rect.X; y = $rect.Y; width = $rect.Width; height = $rect.Height }

  $text = $null
  $supportsTextPattern = $false
  $docRange = $null

  $textPatternObj = $null
  if ($focused.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPatternObj)) {
    $textPattern = $textPatternObj -as [System.Windows.Automation.TextPattern]
    $docRange = $textPattern.DocumentRange
    $text = $docRange.GetText(-1)
    $supportsTextPattern = $true
  } else {
    $valuePatternObj = $null
    if ($focused.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePatternObj)) {
      $valuePattern = $valuePatternObj -as [System.Windows.Automation.ValuePattern]
      $text = $valuePattern.Current.Value
    }
  }

  if ([string]::IsNullOrEmpty($text)) {
    Write-Result @{ ok = $true; skip = $true; reason = "no-text"; processName = $processName }
    exit 0
  }

  $claimRects = @()
  if ($supportsTextPattern -and $SpansB64 -ne "") {
    $spansJson = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($SpansB64))
    $spans = $spansJson | ConvertFrom-Json
    if ($spans -isnot [System.Array]) { $spans = @($spans) }

    $Endp = [System.Windows.Automation.Text.TextPatternRangeEndpoint]
    $Unit = [System.Windows.Automation.Text.TextUnit]

    foreach ($span in $spans) {
      $rects = @()
      $flat = @()
      try {
        # Collapse-then-expand: the standard UIA idiom for getting a text
        # range from a character offset + length rather than a text search.
        # Validated directly against a live document before shipping.
        $range = $docRange.Clone()
        $range.MoveEndpointByUnit($Endp::End, $Unit::Character, -($text.Length + 10)) | Out-Null
        $range.MoveEndpointByUnit($Endp::Start, $Unit::Character, $span.start) | Out-Null
        $range.MoveEndpointByUnit($Endp::End, $Unit::Character, $span.length) | Out-Null

        # Some providers (confirmed with the current Windows 11 Notepad) never
        # compute layout/bounding rects for a range unless it's been scrolled
        # into view first, even when the text is already visible on screen —
        # GetBoundingRectangles otherwise comes back completely empty.
        try { $range.ScrollIntoView($true) | Out-Null } catch {}

        $flat = $range.GetBoundingRectangles()
        for ($i = 0; $i -lt $flat.Length; $i += 4) {
          $w = $flat[$i + 2]
          $h = $flat[$i + 3]
          # Off-screen/scrolled-out matches come back degenerate (zero or
          # negative extents) — skip rather than draw a garbage underline.
          if ($w -gt 0 -and $h -gt 0) {
            $rects += @{ x = $flat[$i]; y = $flat[$i + 1]; width = $w; height = $h }
          }
        }
      } catch {}
      $claimRects += @{ id = $span.id; rects = $rects; rawRectCount = [int]($flat.Length / 4) }
    }
  }

  Write-Result @{
    ok                   = $true
    skip                 = $false
    processName          = $processName
    text                 = $text
    supportsTextPattern  = $supportsTextPattern
    controlRect          = $controlRect
    claimRects           = $claimRects
  }
} catch {
  Write-Result @{ ok = $false; error = $_.Exception.Message }
}
