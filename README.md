# Procom Devices Web

This is the Expo web version of Procom Devices. Open PowerShell in this folder and run:

```powershell
npm ci
npm run web
```

Run the install command once per checkout or when dependencies change. After installation, you can also run `npm run web` from the parent project folder. Open the localhost URL printed by Expo (usually http://localhost:8081) in desktop Chrome.

Connect the controller by USB and click **Connect Device** to select it in Chrome's serial-port chooser. For Modbus, open **RS-485 / Modbus**, use **Find USB serial adapters**, and select your adapter. The operating system must expose the device as a serial port. File exports use the browser's download settings.

Use `npm run build` to export the static web app to `dist`.
