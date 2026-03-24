<#
.SYNOPSIS
    Agent OS — Autonomous Session Chain Launcher

.DESCRIPTION
    Starts or resumes an autonomous Claude Code execution chain.
    Run this once, then walk away. The chain self-sustains until
    the work queue is empty or a review gate is reached.

.PARAMETER Task
    The initial task description for a new chain.
    Mutually exclusive with -Resume.

.PARAMETER Resume
    Resume from existing .claude/chain-context.md.
    Mutually exclusive with -Task.

.PARAMETER ProjectPath
    Path to the Agent OS project root. Defaults to the script's directory.

.EXAMPLE
    .\Start-AgentChain.ps1 -Task "Implement feature X per slice SC-1"

.EXAMPLE
    .\Start-AgentChain.ps1 -Resume

.EXAMPLE
    .\Start-AgentChain.ps1 -Resume -ProjectPath "C:\Users\Cyronick\Documents\clearpath"
#>

param(
    [Parameter(Mandatory = $false)]
    [string]$Task,

    [Parameter(Mandatory = $false)]
    [switch]$Resume,

    [Parameter(Mandatory = $false)]
    [string]$ProjectPath = $PSScriptRoot
)

# ── Validation ────────────────────────────────────────────────

# Mutual exclusivity
if ($Task -and $Resume) {
    Write-Error "Cannot specify both -Task and -Resume. Use one or the other."
    exit 1
}

if (-not $Task -and -not $Resume) {
    Write-Error "Must specify either -Task 'description' or -Resume."
    Write-Host ""
    Write-Host "Usage:" -ForegroundColor Yellow
    Write-Host "  .\Start-AgentChain.ps1 -Task 'Execute slice SC-1'"
    Write-Host "  .\Start-AgentChain.ps1 -Resume"
    exit 1
}

# Project path
if (-not (Test-Path $ProjectPath)) {
    Write-Error "Project path does not exist: $ProjectPath"
    exit 1
}

$claudeMdPath = Join-Path $ProjectPath "CLAUDE.md"
if (-not (Test-Path $claudeMdPath)) {
    Write-Error "CLAUDE.md not found at $ProjectPath. Is this an Agent OS project?"
    exit 1
}

$claudeDir = Join-Path $ProjectPath ".claude"
if (-not (Test-Path $claudeDir)) {
    Write-Error "No .claude directory found at: $ProjectPath"
    exit 1
}

# Claude CLI availability
$claudeCmd = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claudeCmd) {
    Write-Error "Claude CLI not found in PATH. Install Claude Code first."
    exit 1
}

# Resume-specific validation
if ($Resume) {
    $chainContextPath = Join-Path $claudeDir "chain-context.md"
    if (-not (Test-Path $chainContextPath)) {
        Write-Error "No .claude/chain-context.md found. Cannot resume."
        Write-Host "Start a new chain with: .\Start-AgentChain.ps1 -Task 'your task'" -ForegroundColor Yellow
        exit 1
    }
}

# ── Build Prompt ──────────────────────────────────────────────

if ($Resume) {
    $Prompt = "/resume"
    $ModeDisplay = "Resume from chain-context.md"
}
else {
    $Prompt = $Task
    $ModeDisplay = "New task: $Task"
}

# ── Launch ────────────────────────────────────────────────────

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Agent OS — Autonomous Chain Launcher" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Project:  $ProjectPath" -ForegroundColor White
Write-Host "  Mode:     $ModeDisplay" -ForegroundColor White
Write-Host "  Safety:   --dangerously-skip-permissions" -ForegroundColor Yellow
Write-Host ""
Write-Host "  The chain will run autonomously until:" -ForegroundColor Gray
Write-Host "    - Work queue is empty (COMPLETE)" -ForegroundColor Gray
Write-Host "    - A review gate is reached (PAUSED)" -ForegroundColor Gray
Write-Host "    - You close the terminal window" -ForegroundColor Gray
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Launch Claude Code in a new PowerShell window
# The handoff command within the session handles spawning successors.
# This launcher just starts the first session.
Start-Process powershell -ArgumentList @(
    '-NoExit',
    '-Command',
    "Set-Location '$ProjectPath'; claude -p '$($Prompt -replace "'", "''")' --dangerously-skip-permissions"
)

Write-Host "Chain launched in new window." -ForegroundColor Green
Write-Host "This window can be closed." -ForegroundColor Gray
Write-Host ""
Write-Host "To stop the chain: close the active PowerShell window." -ForegroundColor Yellow
Write-Host "To resume later:   .\Start-AgentChain.ps1 -Resume" -ForegroundColor Yellow
Write-Host ""
