// Helper used by the cloud build. Usage: node patch.js prepare | node patch.js android
const fs = require('fs'), path = require('path');
const step = process.argv[2];

if (step === 'prepare') {
  // copy the web app files into www/ (Capacitor's web folder)
  fs.mkdirSync('www', { recursive: true });
  for (const f of ['index.html', 'style.css', 'app.js', 'dtc-database.js', 'obd.js', 'scanner.js', 'logo.png']) {
    if (!fs.existsSync(f)) throw new Error('Missing file: ' + f);
    fs.copyFileSync(f, path.join('www', f));
  }
  console.log('www/ ready');
} else if (step === 'android') {
  const pkgDir = 'android/app/src/main/java/com/aicardoctor/app';
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.copyFileSync('ObdBluetoothPlugin.java', path.join(pkgDir, 'ObdBluetoothPlugin.java'));
  fs.writeFileSync(path.join(pkgDir, 'MainActivity.java'),
`package com.aicardoctor.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ObdBluetoothPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`);
  const mf = 'android/app/src/main/AndroidManifest.xml';
  let x = fs.readFileSync(mf, 'utf8');
  if (!x.includes('BLUETOOTH_CONNECT')) {
    const perms =
`    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-feature android:name="android.hardware.bluetooth" android:required="false" />

    <application`;
    if (!x.includes('<application')) throw new Error('Manifest has no <application> tag');
    x = x.replace('<application', perms);
    fs.writeFileSync(mf, x);
  }
  console.log('android project patched');
} else {
  throw new Error('Usage: node patch.js prepare|android');
}
