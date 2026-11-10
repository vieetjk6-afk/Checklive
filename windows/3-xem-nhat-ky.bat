@echo off
title Checklive - Nhat ky
cd /d "%~dp0.."
echo Nhat ky Checklive (bam Ctrl+C de thoat)
docker compose --profile tunnel logs -f --tail 200 app cloudflared
pause
