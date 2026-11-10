@echo off
title Checklive - Khoi phuc tu ban sao luu
cd /d "%~dp0.."
echo Cac ban sao luu hien co:
dir /b /o-d backups\*.dump
echo.
set /p "FILE=Nhap ten file muon khoi phuc (VD checklive-20261110-0300.dump): "
if not exist "backups\%FILE%" (
  echo [LOI] Khong tim thay backups\%FILE%
  pause
  exit /b 1
)
echo.
echo CANH BAO: Toan bo du lieu hien tai se bi THAY THE bang ban sao luu %FILE%.
set /p "OK=Go DONG Y (viet hoa) de tiep tuc: "
if not "%OK%"=="DONG Y" (
  echo Da huy.
  pause
  exit /b 0
)
echo Sao luu du lieu hien tai truoc khi khoi phuc...
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "TS=%%i"
docker compose exec -T backup pg_dump -h db -U checklive -Fc -f /backups/truoc-khoi-phuc-%TS%.dump checklive
docker compose stop app
docker compose exec -T backup pg_restore -h db -U checklive -d checklive --clean --if-exists --no-owner /backups/%FILE%
docker compose start app
echo Da khoi phuc xong. Ban sao luu truoc khi khoi phuc: backups\truoc-khoi-phuc-%TS%.dump
pause
