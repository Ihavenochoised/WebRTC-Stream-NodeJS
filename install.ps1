# This script will download ffmpeg (or use a provided zip), extract it to user's AppData\Local\ffmpeg, and add it to PATH.

Write-Host "Starting ffmpeg installation..." -ForegroundColor Green

# Ask user for zip path (optional)
Write-Host "`nYou can either:"
Write-Host "1. Press Enter to automatically download ffmpeg"
Write-Host "2. Drag and drop your downloaded ffmpeg zip file here"
$zipPath = Read-Host "`nYour choice"

# Remove quotes if the user's drag-and-drop added them
$zipPath = $zipPath.Trim('"').Trim()

# Define paths
$tempExtractPath = "$env:TEMP\ffmpeg_temp"
$finalPath = "$env:LOCALAPPDATA\ffmpeg"
$downloadPath = "$env:TEMP\ffmpeg-download.zip"

# Download ffmpeg if no path provided
if ([string]::IsNullOrWhiteSpace($zipPath)) {
    Write-Host "`nDownloading ffmpeg from gyan.dev..." -ForegroundColor Cyan
    $zipPath = $downloadPath
    
    try {
        # Use WebClient for progress tracking
        $webClient = New-Object System.Net.WebClient
        
        # Register progress event
        Register-ObjectEvent -InputObject $webClient -EventName DownloadProgressChanged -SourceIdentifier WebClient.DownloadProgressChanged -Action {
            Write-Progress -Activity "Downloading ffmpeg" -Status "Downloading..." -PercentComplete $EventArgs.ProgressPercentage
        } | Out-Null
        
        # Register completion event
        Register-ObjectEvent -InputObject $webClient -EventName DownloadFileCompleted -SourceIdentifier WebClient.DownloadFileCompleted -Action {
            Write-Progress -Activity "Downloading ffmpeg" -Completed
        } | Out-Null
        
        # Start download
        $webClient.DownloadFileAsync((New-Object System.Uri("https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip")), $downloadPath)
        
        # Wait for download to complete
        while ($webClient.IsBusy) {
            Start-Sleep -Milliseconds 100
        }
        
        # Cleanup events
        Unregister-Event -SourceIdentifier WebClient.DownloadProgressChanged -ErrorAction SilentlyContinue
        Unregister-Event -SourceIdentifier WebClient.DownloadFileCompleted -ErrorAction SilentlyContinue
        $webClient.Dispose()
        
        Write-Host "Download complete!" -ForegroundColor Green
    }
    catch {
        Write-Host "Error downloading ffmpeg: $_" -ForegroundColor Red
        Unregister-Event -SourceIdentifier WebClient.DownloadProgressChanged -ErrorAction SilentlyContinue
        Unregister-Event -SourceIdentifier WebClient.DownloadFileCompleted -ErrorAction SilentlyContinue
        Exit
    }
}
else {
    # Verify the provided zip file exists
    if (-not (Test-Path $zipPath)) {
        Write-Host "Error: Could not find the zip file at $zipPath" -ForegroundColor Red
        Exit
    }
}

# Clean up temp directory if it exists
if (Test-Path $tempExtractPath) {
    Remove-Item -Path $tempExtractPath -Recurse -Force
}

# Unzip the ffmpeg zip file to temp location
Write-Host "`nExtracting ffmpeg..." -ForegroundColor Cyan

# Create a progress bar for extraction
$extractJob = Start-Job -ScriptBlock {
    param($zip, $dest)
    Expand-Archive -Path $zip -DestinationPath $dest -Force
} -ArgumentList $zipPath, $tempExtractPath

# Show progress while extracting
$progress = 0
while ($extractJob.State -eq 'Running') {
    $progress = ($progress + 10) % 100
    Write-Progress -Activity "Extracting ffmpeg" -Status "Please wait..." -PercentComplete $progress
    Start-Sleep -Milliseconds 200
}

Wait-Job $extractJob | Out-Null
Receive-Job $extractJob | Out-Null
Remove-Job $extractJob
Write-Progress -Activity "Extracting ffmpeg" -Completed

Write-Host "Extraction complete!" -ForegroundColor Green

# Find the extracted ffmpeg folder
$extractedFolder = Get-ChildItem -Path $tempExtractPath -Directory | Select-Object -First 1

if (-not $extractedFolder) {
    Write-Host "Error: Could not find extracted ffmpeg folder." -ForegroundColor Red
    Exit
}

Write-Host "Found: $($extractedFolder.Name)" -ForegroundColor Cyan

# Remove existing ffmpeg directory if it exists
if (Test-Path $finalPath) {
    Write-Host "`nRemoving existing ffmpeg installation..." -ForegroundColor Yellow
    Remove-Item -Path $finalPath -Recurse -Force
}

# Move the contents to the final destination
Write-Host "Installing ffmpeg to $finalPath..." -ForegroundColor Cyan
Move-Item -Path $extractedFolder.FullName -Destination $finalPath -Force

# Clean up
Remove-Item -Path $tempExtractPath -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path $downloadPath) {
    Remove-Item -Path $downloadPath -Force -ErrorAction SilentlyContinue
}

# Set the bin path
$ffmpegBinPath = "$finalPath\bin"

if (-not (Test-Path $ffmpegBinPath)) {
    Write-Host "Error: Could not find ffmpeg bin directory at $ffmpegBinPath" -ForegroundColor Red
    Exit
}

Write-Host "FFmpeg bin located at: $ffmpegBinPath" -ForegroundColor Green

# Add ffmpeg bin path to user's PATH environment variable if not already present
$envPath = [System.Environment]::GetEnvironmentVariable("Path", "User")

If ($envPath -notlike "*$ffmpegBinPath*") {
    Write-Host "`nAdding ffmpeg to PATH..." -ForegroundColor Cyan
    $newEnvPath = $envPath + ";" + $ffmpegBinPath
    [System.Environment]::SetEnvironmentVariable("Path", $newEnvPath, "User")
    Write-Host "ffmpeg added to PATH!" -ForegroundColor Green
} else {
    Write-Host "`nffmpeg is already in PATH." -ForegroundColor Yellow
}

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "Installation complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "`nTest ffmpeg by opening a NEW terminal and typing: ffmpeg -version" -ForegroundColor Cyan
Write-Host "(You must open a new terminal for PATH changes to take effect)`n" -ForegroundColor Yellow