const express = require('express')
const webserver = express()
 .listen(3000, () => console.log(`Listening on ${3000}`))
const { WebSocketServer } = require('ws')
const sockserver = new WebSocketServer({ port: 443 })
sockserver.on('connection', ws => {
 console.log('New client connected!')
 ws.send(JSON.stringify({ msg : 'connection established' }))
 ws.on('close', () => console.log('Client has disconnected!'))
 ws.on('message', data => {
    const message = JSON.parse(data);
   sockserver.clients.forEach(client => {
       if (client !== ws) {
           console.log(`distributing message: `, message)
           client.send(`${data}`)
       }
   })
 })
 ws.onerror = function () {
   console.log('websocket error')
 }
})
