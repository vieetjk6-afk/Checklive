@echo off
title Checklive - Dung
cd /d "%~dp0.."
echo Dang dung Checklive (du lieu van duoc giu nguyen)...
docker compose --profile tunnel stop
echo Da dung. Chay 1-khoi-dong.bat de bat lai.
pause
