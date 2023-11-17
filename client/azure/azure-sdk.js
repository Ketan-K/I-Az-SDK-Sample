const { ipcMain } = require('electron')
const os = require('os')
const path = require('path')
var packageJson = { version: '0.0.1'}
var ffi = require('@lwahonen/ffi-napi');
var ref = require('@lwahonen/ref-napi');

// define pointer types used for interacting with the native host DLL
var nativeHost = ref.types.void
var nativeHostPtr = ref.refType(nativeHost)
var nativeHostPtrPtr = ref.refType(nativeHostPtr)

class MMRBrowserWindow {
  constructor(browserWindow, host, options) {
    this.browserWindow = browserWindow
    this.id = browserWindow.id
    this.host = host

    this.subscribeToElectronBrowserWindowEvents()
    this.connectionHandle = this.createConnectionToNativeHost(options)
    this.registerCallbacksWithNativeHost()
  }

  close() {
    this.browserWindow = null

    if (this.connectionHandle != null) {
      this.host.closeNativeHostConnection(this.connectionHandle)
      this.connectionHandle = null
    }

    this.host = null
    this.sendMessageCallback = null
    this.isActiveCallback = null
    this.reloadWindowCallback = null
  }

  subscribeToElectronBrowserWindowEvents() {
    let mmrBrowserWindow = this
    this.browserWindow.once('closed', () => {
      mmrBrowserWindow.close()
    })
  }

  createConnectionToNativeHost(options) {
    var redirectMedia = false
    var redirectWebrtc = true
    if (options != undefined) {
      if (options['redirectMedia'] != undefined) {
        redirectMedia = (options['redirectMedia'] != 0)
      }
      if (options['redirectWebrtc'] != undefined) {
        redirectWebrtc = (options['redirectWebrtc'] != 0)
      }
    }

    var connectionHandlePtr = ref.alloc(nativeHostPtrPtr)
    this.host.createNativeHostConnection(packageJson.version, this.browserWindow.webContents.getUserAgent(), redirectMedia, redirectWebrtc, connectionHandlePtr)
    return connectionHandlePtr.deref()
  }

  registerCallbacksWithNativeHost() {
    let mmrBrowserWindow = this

    this.sendMessageCallback = ffi.Callback('void', ['string', 'string'], (channel, jsonMessage) => {
      mmrBrowserWindow.browserWindow.webContents.send(channel, {type: "msg", payload: JSON.parse(jsonMessage)})
    })
    this.host.setSendMessageCallback(this.connectionHandle, this.sendMessageCallback)

    this.isActiveCallback = ffi.Callback('void', ['bool', 'bool', 'bool'], (clientIsConnected, mmrIsActive, webrtcIsActive) => {
      // Instead of just logging, we could raise an event here that the app can use for displaying a 'MMR is active' indicator.
      console.log('IsActive callback received: Client connected = ' + clientIsConnected + ' MMR active = ' + mmrIsActive + ' WebRTC active = ' + webrtcIsActive)
    })
    this.host.setIsActiveCallback(this.connectionHandle, this.isActiveCallback)

    this.reloadWindowCallback = ffi.Callback('void', [], () => {
      console.log('ReloadWindow callback received.')
      mmrBrowserWindow.browserWindow.webContents.reload()
    })
    this.host.setReloadWindowCallback(this.connectionHandle, this.reloadWindowCallback)
  }

  listenToMessagesFromRendererProcess() {
    let mmrBrowserWindow = this

    ipcMain.on(this.host.getMainChannel(this.connectionHandle), (event, value) => {
      if (value['type'] === 'msg') {
        mmrBrowserWindow.host.receiveMessageFromRenderer(mmrBrowserWindow.connectionHandle, JSON.stringify(value['payload']))
      } else if (value['type'] === 'disconnect') {
        mmrBrowserWindow.host.receiveDisconnectFromRenderer(mmrBrowserWindow.connectionHandle);
      }
    })

    // This isn't used right now, and might be removed
    ipcMain.on(this.host.getLoggingChannel(this.connectionHandle), (event, value) => {
      mmrBrowserWindow.host.receiveLogFromRenderer(mmrBrowserWindow.connectionHandle, JSON.stringify(value['payload']))
    })
  }

  openChannels() {
    // Channel names will change, so remove old listeners
    if (this.host.getMainChannel(this.connectionHandle) != "") {
      ipcMain.removeAllListeners(this.host.getMainChannel(this.connectionHandle))
    }
    if (this.host.getLoggingChannel(this.connectionHandle) != "") {
      ipcMain.removeAllListeners(this.host.getLoggingChannel(this.connectionHandle))
    }

    var result = this.host.openChannels(this.connectionHandle, this.id)
    this.listenToMessagesFromRendererProcess()
    return result
  }

  startRemoteTracing() {
    this.browserWindow.webContents.send(this.host.getLoggingChannel(this.connectionHandle), {messageType: "startFullTrace"})
  }

  stopRemoteTracing() {
    this.browserWindow.webContents.send(this.host.getLoggingChannel(this.connectionHandle), {messageType: "stopFullTrace"})
  }
}

class MmrWindowManager {
  constructor(nativeHostDllFolder) {
    this.windowMap = new Map()
    this.loadNativeHostDll(nativeHostDllFolder)

    ipcMain.on('MsRdcMmrBackgroundComm', (event, message) => {
      if (message['type'] === 'init') {
        var id = event.sender.id
        console.log('Got a MMR init message from window id ' + id)
        var mmrWindow = this.windowMap.get(id)
        if (mmrWindow != undefined) {
          event.returnValue = mmrWindow.openChannels()
        } else {
          console.log('Window id ' + id + ' is not found, dropping MMR Init message.')
          event.returnValue = ""
        }
      }
    })
  }

  add(browserWindow, options) {
    var id = browserWindow.id
    if (!this.windowMap.has(id)) {
      this.windowMap.set(id, new MMRBrowserWindow(browserWindow, this.host, options))
    }
  }

  remove(browserWindow) {
    var id = browserWindow.id
    if (this.windowMap.has(id)) {
      var mmrWindow = this.windowMap.get(id)
      mmrWindow.close()
      this.windowMap.delete(id)
    }
  }

  startRemoteTracing() {
    for (const mmrWindow of this.windowMap.values()) {
      mmrWindow.startRemoteTracing()
    }
  }

  stopRemoteTracing() {
    for (const mmrWindow of this.windowMap.values()) {
      mmrWindow.stopRemoteTracing()
    }
  }

  close() {
    console.log('Closing the MmrWindowManager')
    for (const mmrWindow of this.windowMap.values()) {
      mmrWindow.close()
    }
    this.windowMap.clear()
    this.host = null
  }

  loadNativeHostDll(nativeHostDllFolder) {
     // const file = path.join(process.cwd() , `resources/azure/DLLs`, os.arch() , 'MsMmrHostDLL.dll')
     const file = path.join(__dirname , `DLLs`, os.arch() , 'MsMmrHostDLL.dll')

     console.log('Hey there', file)
    this.host = ffi.Library(file, {
      'createNativeHostConnection': [ 'int', [ 'string', 'string', 'bool', 'bool', nativeHostPtrPtr ] ],
      'closeNativeHostConnection': [ 'void', [ nativeHostPtr ] ],
      'setSendMessageCallback': [ 'void', [ nativeHostPtr, 'pointer' ] ],
      'setIsActiveCallback': [ 'void', [ nativeHostPtr, 'pointer' ] ],
      'setReloadWindowCallback': [ 'void', [ nativeHostPtr, 'pointer' ] ],
      'openChannels': [ 'string', [ nativeHostPtr, 'int64' ] ],
      'getMainChannel': [ 'string', [ nativeHostPtr ] ],
      'getLoggingChannel': [ 'string', [ nativeHostPtr ] ],
      'receiveMessageFromRenderer': [ 'void', [ nativeHostPtr, 'string' ] ],
      'receiveDisconnectFromRenderer': [ 'void', [ nativeHostPtr ] ],
      'receiveLogFromRenderer': [ 'void', [ nativeHostPtr, 'string' ] ]
    })
}
}
function sdk() {
  console.log('[Azure] : ', process.cwd(), ' :: Dir name ::', __dirname)
  return new MmrWindowManager('./DLLs')
}

module.exports = { sdk };
