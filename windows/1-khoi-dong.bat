@echo off
title Checklive - Khoi dong
cd /d "%~dp0.."

where docker >nul 2>nul
if errorlevel 1 (
  echo [LOI] Chua cai Docker Desktop.
  echo Tai tai: https://www.docker.com/products/docker-desktop/
  pause
  exit /b 1
)
docker info >nul 2>nul
if errorlevel 1 (
  echo [LOI] Docker Desktop chua chay.
  echo Hay mo Docker Desktop, doi bieu tuong ca voi o goc man hinh hien "running" roi chay lai file nay.
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N'); $t=[IO.File]::ReadAllText('.env') -replace 'thay-bang-chuoi-ngau-nhien-that-dai-it-nhat-32-ky-tu',$s; [IO.File]::WriteAllText('.env',$t,(New-Object Text.UTF8Encoding $false))"
  echo Da tao file cau hinh .env
  echo  - Doi ADMIN_PASSWORD thanh mat khau cua ban
  echo  - Neu dung Cloudflare Tunnel: dan ma vao dong TUNNEL_TOKEN=
  echo Luu file bang Ctrl+S, dong Notepad roi chay lai file nay.
  notepad ".env"
  pause
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "if ((Get-Content '.env') -match '^ADMIN_PASSWORD=doi-mat-khau-nay\s*$') { exit 1 } else { exit 0 }"
if errorlevel 1 (
  echo [CANH BAO] Ban chua doi ADMIN_PASSWORD trong file .env. Hay doi roi chay lai.
  notepad ".env"
  pause
  exit /b 1
)

set "PROFILE="
powershell -NoProfile -ExecutionPolicy Bypass -Command "if ((Get-Content '.env') -match '^TUNNEL_TOKEN=\S+') { exit 0 } else { exit 1 }"
if not errorlevel 1 set "PROFILE=--profile tunnel"

echo Dang khoi dong Checklive... (lan dau mat khoang 5-10 phut de tai va dung)
docker compose %PROFILE% up -d --build
if errorlevel 1 (
  echo [LOI] Khoi dong that bai. Chay 3-xem-nhat-ky.bat de xem loi, hoac chup man hinh gui ho tro.
  pause
  exit /b 1
)

echo.
echo ==========================================================
echo  Checklive dang chay
echo  Tren may nay:  http://localhost:3000
if defined PROFILE echo  Qua Internet:  ten mien ban da cai trong Cloudflare Tunnel
echo  Sao luu tu dong 6 tieng/lan vao thu muc backups
echo ==========================================================
start "" "http://localhost:3000"
pause
