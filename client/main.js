const { app, BrowserWindow } = require('electron');
const path = require('path')

const { initializeAzureSDK } = require('./azure/azure-sdk-loader')

let appWindow
const createWindow = () => {
  appWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'azure/mmr/preload.js'),
      devTools: true,
    }
  })

  appWindow.webContents.openDevTools()

  initializeAzureSDK(appWindow);

  appWindow.loadFile('index.html')

}

app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
