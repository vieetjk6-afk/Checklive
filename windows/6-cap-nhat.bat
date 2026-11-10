@echo off
title Checklive - Cap nhat
cd /d "%~dp0.."
if exist ".git" (
  echo Dang tai ban moi...
  git pull
  if errorlevel 1 (
    echo [LOI] Khong tai duoc ban moi.
    pause
    exit /b 1
  )
) else (
  echo Thu muc nay khong dung git.
  echo Hay tai ban ZIP moi, giai nen de len thu muc nay (GIU LAI file .env va thu muc backups^), roi chay lai file nay.
  pause
)
call "%~dp01-khoi-dong.bat"
