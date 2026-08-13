<#
  One-shot UI Automation snapshot of the currently focused text field, used
  by Tracely's Screen Watch feature. Invoked fresh on every poll tick by the
  Electron main process (see src/main/services/screenWatch) rather than kept
  running as a persistent process, to avoid the complexity/fragility of
  async stdin command handling in PowerShell.

  Params:
    -Mode            "snapshot" (default, unchanged read-only behavior),
                     "insert" (type a citation into the focused field at a
                     known offset), or "undo" (send Ctrl+Z to the focused
                     app) — see insert/undo modes below.
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
    -InsertOffset    (insert mode) character offset into the focused
                     control's current text to insert at.
    -InsertTextB64   (insert mode) base64 UTF-8 of the citation text to type.
    -ExpectedSnippetB64
                     (insert mode) base64 UTF-8 of the ~30 characters the
                     Node side last saw starting at InsertOffset — a cheap
                     staleness check. If the live text at that offset no
                     longer starts with this snippet, the document changed
                     since the claim was located and the insert is aborted
                     rather than typing into the wrong spot.

  Always prints exactly one line of JSON to stdout and exits.
#>
param(
  [string]$Mode = "snapshot",
  [string]$SpansB64 = "",
  [string]$SelfProcessName = "Tracely.exe",
  [string]$InsertOffset = "",
  [string]$InsertTextB64 = "",
  [string]$ExpectedSnippetB64 = ""
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
  Add-Type -AssemblyName System.Windows.Forms
} catch {
  Write-Result @{ ok = $false; error = "UIAutomation assemblies unavailable: $($_.Exception.Message)" }
  exit 0
}

# Insert/undo modes both need the currently focused element and its process
# name, same as snapshot mode, but nothing else from the big read-path try
# block below — handled here and the script exits before reaching it.
if ($Mode -eq "insert" -or $Mode -eq "undo") {
  try {
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($null -eq $focused) {
      Write-Result @{ ok = $false; error = "No focused element - the target app may have lost focus." }
      exit 0
    }

    $processName = "unknown"
    try {
      $proc = Get-Process -Id $focused.Current.ProcessId -ErrorAction Stop
      $processName = "$($proc.ProcessName).exe"
    } catch {}

    if ($processName -ieq $SelfProcessName) {
      Write-Result @{ ok = $false; error = "Focus moved to Tracely itself - nothing to insert into." }
      exit 0
    }

    if ($Mode -eq "undo") {
      # One paste is one undo step in effectively every real text editor and
      # browser, so a plain Ctrl+Z is reliable here without Tracely tracking
      # its own undo stack — the target app's own history does the work.
      [System.Windows.Forms.SendKeys]::SendWait("^z")
      Write-Result @{ ok = $true; processName = $processName }
      exit 0
    }

    # Mode -eq "insert" from here.
    $textPatternObj2 = $null
    if (-not $focused.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPatternObj2)) {
      Write-Result @{ ok = $false; error = "Focused control no longer supports text access." }
      exit 0
    }
    $textPattern2 = $textPatternObj2 -as [System.Windows.Automation.TextPattern]
    $docRange2 = $textPattern2.DocumentRange
    $liveText = $docRange2.GetText(-1)

    $offset = 0
    if (-not [int]::TryParse($InsertOffset, [ref]$offset)) {
      Write-Result @{ ok = $false; error = "Invalid insert offset." }
      exit 0
    }

    $expectedSnippet = ""
    if ($ExpectedSnippetB64 -ne "") {
      $expectedSnippet = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ExpectedSnippetB64))
    }
    if ($expectedSnippet -ne "") {
      $actualSnippet = ""
      if ($offset -ge 0 -and $offset -lt $liveText.Length) {
        $len = [Math]::Min($expectedSnippet.Length, $liveText.Length - $offset)
        $actualSnippet = $liveText.Substring($offset, $len)
      }
      if ($actualSnippet -ne $expectedSnippet) {
        Write-Result @{ ok = $false; error = "The document changed since this claim was located - try again." }
        exit 0
      }
    }

    $citationText = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($InsertTextB64))

    $Endp2 = [System.Windows.Automation.Text.TextPatternRangeEndpoint]
    $Unit2 = [System.Windows.Automation.Text.TextUnit]
    try {
      $insertRange = $docRange2.Clone()
      $insertRange.MoveEndpointByUnit($Endp2::End, $Unit2::Character, -($liveText.Length + 10)) | Out-Null
      $insertRange.MoveEndpointByUnit($Endp2::Start, $Unit2::Character, $offset) | Out-Null
      # Moving Start past the collapsed End above drags End along with it
      # (the standard UIA collapse-then-expand idiom, same one already used
      # for underline spans below) — End is already sitting at $offset too
      # at this point, so it's moved by a LENGTH of 0 here, not by $offset
      # again. Moving it by $offset a second time was the original bug:
      # it produced a range covering [$offset, 2*$offset] instead of a
      # zero-length caret, so Select()+paste below replaced however much
      # text happened to sit in that stretch instead of just inserting.
      $insertRange.MoveEndpointByUnit($Endp2::End, $Unit2::Character, 0) | Out-Null
      $insertRange.ScrollIntoView($true) | Out-Null

      # Defensive check: if the range somehow isn't actually collapsed
      # (a future refactor regresses the math above, or a provider handles
      # MoveEndpointByUnit differently than expected), abort instead of
      # letting Select()+paste silently overwrite a stretch of the user's
      # real document text.
      $rangeText = ""
      try { $rangeText = $insertRange.GetText($liveText.Length + 10) } catch {}
      if ($rangeText.Length -gt 0) {
        Write-Result @{ ok = $false; error = "Could not safely place the cursor (selection wasn't empty) - nothing was inserted." }
        exit 0
      }

      # Collapses the target app's own caret/selection to this exact point —
      # deliberately not ValuePattern.SetValue, which would replace the
      # entire field's content and lose formatting/undo history.
      $insertRange.Select() | Out-Null
    } catch {
      Write-Result @{ ok = $false; error = "Could not place the cursor at the insertion point: $($_.Exception.Message)" }
      exit 0
    }

    # Typed via the clipboard rather than SendKeys-per-character: SendKeys
    # treats +^%~(){} as control characters, which real citation text
    # (parentheses, commas) would otherwise need fragile escaping for, and a
    # paste is a single native edit the target app's own undo already
    # understands. The user's existing clipboard content is restored right
    # after, so this never permanently clobbers what they had copied.
    $previousClipboard = $null
    try { $previousClipboard = [System.Windows.Forms.Clipboard]::GetText() } catch {}
    try {
      [System.Windows.Forms.Clipboard]::SetText($citationText)
      [System.Windows.Forms.SendKeys]::SendWait("^v")
      Start-Sleep -Milliseconds 200
    } finally {
      try {
        if ($null -ne $previousClipboard -and $previousClipboard -ne "") {
          [System.Windows.Forms.Clipboard]::SetText($previousClipboard)
        } else {
          [System.Windows.Forms.Clipboard]::Clear()
        }
      } catch {}
    }

    Write-Result @{ ok = $true; processName = $processName }
    exit 0
  } catch {
    Write-Result @{ ok = $false; error = $_.Exception.Message }
    exit 0
  }
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
  # "is this editable" flag, so ValuePattern.IsReadOnly is used as the
  # authoritative signal whenever it's exposed (it's an explicit, direct
  # answer to "is this editable"). ControlType (Edit/Document only) is only
  # a fallback heuristic for controls that expose TextPattern but no
  # ValuePattern at all — trusting ControlType over an explicit
  # IsReadOnly=false was rejecting legitimate editors (confirmed: some
  # in-place cell/grid editors) that don't report a plain Edit/Document
  # ControlType.
  $roCheckObj = $null
  $hasValuePattern = $focused.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$roCheckObj)
  if ($hasValuePattern) {
    try {
      $roCheckPattern = $roCheckObj -as [System.Windows.Automation.ValuePattern]
      if ($roCheckPattern.Current.IsReadOnly) {
        Write-Result @{ ok = $true; skip = $true; reason = "read-only"; processName = $processName }
        exit 0
      }
    } catch {}
  } else {
    $controlTypeName = $focused.Current.ControlType.ProgrammaticName
    $editableControlTypes = @('ControlType.Edit', 'ControlType.Document')
    if ($editableControlTypes -notcontains $controlTypeName) {
      Write-Result @{ ok = $true; skip = $true; reason = "not-editable-control-type"; processName = $processName }
      exit 0
    }
  }

  $rect = $focused.Current.BoundingRectangle
  $controlRect = @{ x = $rect.X; y = $rect.Y; width = $rect.Width; height = $rect.Height }

  # Walk up to the focused control's top-level application window so the
  # overlay can be sized/clipped to that one window instead of the whole
  # display — without this, Screen Watch reads whichever control has OS
  # keyboard focus but draws across the entire monitor, so underlines can
  # appear to "leak" outside the app that's actually focused (e.g. over
  # whatever else happens to be on screen) whenever a provider's reported
  # text-range rectangles don't line up perfectly with the visible viewport.
  # A max iteration count guards against an unexpected tree shape looping
  # forever; falling back to the control's own rect if no Window ancestor is
  # found is a graceful degrade back to the old single-control behavior
  # rather than a hard failure.
  $windowRect = $controlRect
  try {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $ancestor = $focused
    $hops = 0
    while ($ancestor -ne $null -and $hops -lt 25) {
      if ($ancestor.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window) {
        $wr = $ancestor.Current.BoundingRectangle
        if ($wr.Width -gt 0 -and $wr.Height -gt 0) {
          $windowRect = @{ x = $wr.X; y = $wr.Y; width = $wr.Width; height = $wr.Height }
        }
        break
      }
      $ancestor = $walker.GetParent($ancestor)
      $hops++
    }
  } catch {}

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

      # No ScrollIntoView here. It used to run unconditionally, for every
      # tracked claim, on every 1.2s poll — so Screen Watch actively scrolled
      # the user's document out from under them while they were reading it.
      #
      # It is not needed: GetBoundingRectangles reports the currently visible
      # portion of a range from the provider's existing layout, and returns
      # empty or degenerate rects for anything off-screen, which
      # Get-RectsFromBoundingArray already filters. That is exactly the
      # documented invariant "underlines only ever appear over currently
      # visible text" — which the scroll was quietly defeating by dragging
      # every claim into view so it could be measured.
      #
      # It also made the measurements mutually inconsistent: with N claims the
      # loop scrolled to claim 1, measured, then scrolled to claim 2 — moving
      # the document — so every claim but the last was measured against a
      # layout that no longer existed by the time the payload was sent.
      #
      # The identical call in -Mode insert is user-initiated and stays.
      # $scrollError is still emitted so the output shape is unchanged.
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
    windowRect             = $windowRect
    claimRects             = $claimRects
    wholeDocRectCount      = $wholeDocRectCount
    visibleRangeCount      = $visibleRangeCount
    visibleRangeRectCount  = $visibleRangeRectCount
  }
} catch {
  Write-Result @{ ok = $false; error = $_.Exception.Message }
}
