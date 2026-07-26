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

# GetBoundingRectangles() is documented as returning a flat double[]
# (x,y,width,height per rect, four values per rect), which is what the rest
# of this script originally assumed. In practice at least one provider
# (confirmed: Chrome/Chromium's UIA bridge) instead hands back an array of
# System.Windows.Rect objects — parsing that as a flat double[] doesn't throw
# cleanly, it just quietly reads garbage (an out-of-range Rect object where a
# number was expected), which surfaced as "Cannot compare X because it is
# not IComparable" once that garbage hit a numeric comparison. Handle both
# shapes explicitly rather than assume one.
function Get-RectsFromBoundingArray($flat) {
  $result = @()
  if (-not $flat -or $flat.Length -eq 0) { return $result }

  if ($flat[0] -is [System.Windows.Rect]) {
    foreach ($r in $flat) {
      if ($r.Width -gt 0 -and $r.Height -gt 0) {
        $result += @{ x = $r.X; y = $r.Y; width = $r.Width; height = $r.Height }
      }
    }
  } else {
    for ($i = 0; $i -lt $flat.Length; $i += 4) {
      $w = $flat[$i + 2]
      $h = $flat[$i + 3]
      if ($w -gt 0 -and $h -gt 0) {
        $result += @{ x = $flat[$i]; y = $flat[$i + 1]; width = $w; height = $h }
      }
    }
  }
  return $result
}

function Get-RectCount($flat) {
  if (-not $flat -or $flat.Length -eq 0) { return 0 }
  if ($flat[0] -is [System.Windows.Rect]) { return $flat.Length }
  return [int]($flat.Length / 4)
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

  # Only read/underline text the user can actually edit — not arbitrary
  # focusable text on a webpage or elsewhere. UIA has no single universal
  # "is this editable" flag, so this combines two checks:
  #  1. ControlType: real editors report Edit or Document; plain readable
  #     text on a page is typically Text/Pane/Group/Custom, even when it
  #     happens to be focusable (e.g. a tabindex'd element).
  #  2. ValuePattern.IsReadOnly, when that pattern is exposed — catches
  #     things that report an editable-looking ControlType but are actually
  #     read-only (a <textarea readonly>, a locked form field, etc).
  $controlTypeName = $focused.Current.ControlType.ProgrammaticName
  $editableControlTypes = @('ControlType.Edit', 'ControlType.Document')
  if ($editableControlTypes -notcontains $controlTypeName) {
    Write-Result @{ ok = $true; skip = $true; reason = "not-editable-control-type"; processName = $processName }
    exit 0
  }

  try {
    $roCheckObj = $null
    if ($focused.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$roCheckObj)) {
      $roCheckPattern = $roCheckObj -as [System.Windows.Automation.ValuePattern]
      if ($roCheckPattern.Current.IsReadOnly) {
        Write-Result @{ ok = $true; skip = $true; reason = "read-only"; processName = $processName }
        exit 0
      }
    }
  } catch {}

  $rect = $focused.Current.BoundingRectangle
  $controlRect = @{ x = $rect.X; y = $rect.Y; width = $rect.Width; height = $rect.Height }

  $text = $null
  $supportsTextPattern = $false
  $docRange = $null

  # Diagnostic: does this provider compute bounding rects for ANYTHING via
  # TextPattern, independent of how we built our range? If the whole
  # DocumentRange and the control's own visible ranges also return zero
  # rects, that rules out our range-construction method as the cause —
  # the provider just doesn't implement layout for TextPattern ranges here.
  $wholeDocRectCount = -1
  $visibleRangeCount = -1
  $visibleRangeRectCount = -1

  $textPatternObj = $null
  if ($focused.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPatternObj)) {
    $textPattern = $textPatternObj -as [System.Windows.Automation.TextPattern]
    $docRange = $textPattern.DocumentRange
    $text = $docRange.GetText(-1)
    $supportsTextPattern = $true

    try {
      $wholeFlat = $docRange.GetBoundingRectangles()
      $wholeDocRectCount = Get-RectCount $wholeFlat
    } catch {}

    try {
      $visible = $textPattern.GetVisibleRanges()
      $visibleRangeCount = if ($visible) { $visible.Length } else { 0 }
      if ($visibleRangeCount -gt 0) {
        $visFlat = $visible[0].GetBoundingRectangles()
        $visibleRangeRectCount = Get-RectCount $visFlat
      }
    } catch {}
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
      $rangeTextPreview = $null
      $moveError = $null
      $scrollError = $null
      $rectError = $null

      try {
        # Collapse-then-expand: the standard UIA idiom for getting a text
        # range from a character offset + length rather than a text search.
        $range = $docRange.Clone()
        $range.MoveEndpointByUnit($Endp::End, $Unit::Character, -($text.Length + 10)) | Out-Null
        $range.MoveEndpointByUnit($Endp::Start, $Unit::Character, $span.start) | Out-Null
        $range.MoveEndpointByUnit($Endp::End, $Unit::Character, $span.length) | Out-Null
      } catch {
        $moveError = $_.Exception.Message
      }

      # Diagnostic: what text does the provider think this range actually
      # covers? If this doesn't match the claim text, the offset math (or the
      # provider's Character-unit granularity) is wrong — a completely
      # different bug from "rects came back empty".
      try { $rangeTextPreview = $range.GetText(120) } catch { $rangeTextPreview = "<error: $($_.Exception.Message)>" }

      try {
        $range.ScrollIntoView($true) | Out-Null
      } catch {
        $scrollError = $_.Exception.Message
      }

      try {
        $flat = $range.GetBoundingRectangles()
        # Off-screen/scrolled-out matches come back degenerate (zero or
        # negative extents) — Get-RectsFromBoundingArray skips those rather
        # than drawing a garbage underline.
        $rects = Get-RectsFromBoundingArray $flat
      } catch {
        $rectError = $_.Exception.Message
      }

      $claimRects += @{
        id               = $span.id
        rects            = $rects
        rawRectCount     = Get-RectCount $flat
        rangeTextPreview = $rangeTextPreview
        moveError        = $moveError
        scrollError      = $scrollError
        rectError        = $rectError
      }
    }
  }

  Write-Result @{
    ok                     = $true
    skip                   = $false
    processName            = $processName
    text                   = $text
    supportsTextPattern    = $supportsTextPattern
    controlRect            = $controlRect
    claimRects             = $claimRects
    wholeDocRectCount      = $wholeDocRectCount
    visibleRangeCount      = $visibleRangeCount
    visibleRangeRectCount  = $visibleRangeRectCount
  }
} catch {
  Write-Result @{ ok = $false; error = $_.Exception.Message }
}
