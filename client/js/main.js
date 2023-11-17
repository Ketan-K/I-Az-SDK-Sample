/*
 *  Copyright (c) 2021 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

'use strict';

const callButton = document.getElementById('callButton');
const acceptButton = document.getElementById('acceptButton');
const promoteButton = document.getElementById('promoteButton');
const changeBitRateButton = document.getElementById('changeBitRateButton');
const changeFrameRateButton = document.getElementById('changeFrameRateButton');
const changeResolutionButton = document.getElementById('changeResolutionButton');
const muteAudioButton = document.getElementById('muteAudioButton');
const muteVideoButton = document.getElementById('muteVideoButton');
const hangupButton = document.getElementById('hangupButton');
hangupButton.disabled = true;

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

let isAudioMuted = false;
let isVideoMuted = false;
let user = 'user1';

let pc;
let localStream;

const webSocket = new WebSocket('ws://localhost:443/');

webSocket.onmessage = e => {
  const data = JSON.parse(e.data);
  console.log('received message:', data.type);
  // if (data.type !== 'candidate') {
  //   alert('received message:' + data.type);
  // }
  if (data.type === 'called') {
    callButton.disabled = true;   // user-2
  }
  if (!localStream) {
    return;
  }
  switch (data.type) {
    case 'offer':
      onSdpOfferReceived(data);  // user-2
      break;
    case 'answer':
      onSdpAnswerReceived(data); // user-1
      break;
    case 'candidate':
      onIceCandidateReceived(data);  // user-1, user-2
      break;
    case 'called':
    case 'accepted':
        // A second tab joined. This tab will initiate a call unless in a call already.
        if (pc) {
            console.log('already in call, ignoring');
            return;
        }
        onCallAccepted();   // user-1
        break;
    case 'bye':
      if (pc) {
        hangup();
      }
      break;
    default:
      console.log('unhandled', e);
      break;
  }
};

callButton.onclick = async () => {
  console.log('1.1 -> called...');
  console.log('1.2 -> getting self stream');
  localStream = await navigator.mediaDevices.getUserMedia({audio: true, video: false});
  localVideo.srcObject = localStream;


  callButton.disabled = true;
  acceptButton.disabled = true;
  hangupButton.disabled = false;
  console.log('1.3 -> broadcasting called');
  webSocket.send(JSON.stringify({type: 'called'}));
};


promoteButton.onclick = async () => {
    console.log('promoting the call...');

    navigator.mediaDevices
      .getUserMedia({video: true})
      .then(stream => {
        const videoTracks = stream.getVideoTracks();
        if (videoTracks.length > 0) {
          console.log(`Using video device: ${videoTracks[0].label}`);
        }
        localStream.addTrack(videoTracks[0]);
        localVideo.srcObject = null;
        localVideo.srcObject = localStream;
        pc.addTrack(videoTracks[0], localStream);
        return pc.createOffer();
      }).then(async(offer) => {
        console.log('resending offer');
        console.log('broadcasting offer');
        webSocket.send(JSON.stringify({type: 'offer', sdp: offer.sdp}));
        console.log('setting local description');
        await pc.setLocalDescription(offer);
      })
};

changeBitRateButton.onclick = async () => {
    console.log('chaning bit rate...');
    const senders = pc.getSenders();
    senders.forEach((sender) => {
        console.log('sender.track.type:', sender);
        if(sender.track.kind === 'video') {
            const parameters = sender.getParameters();
            parameters.encodings[0].maxBitrate = 64 * 1000;
            sender.setParameters(parameters);
        }
    });
};

changeFrameRateButton.onclick = async () => {
    console.log('chaning frame rate...');
    const videotrack = localStream.getVideoTracks()[0];
    videotrack.applyConstraints({ frameRate: { max: 10 } });
};

changeResolutionButton.onclick = async () => {
  console.log('changing resolution...');
  const videotrack = localStream.getVideoTracks()[0];
  const constraints = {
    width: 1280,
    aspectRatio: (localVideo.videoWidth / localVideo.videoHeight),
  };
  console.log('aspectRatio:', constraints.aspectRatio);
  await videotrack.applyConstraints(constraints);
  console.log('resolution changed successfully...');
};

muteAudioButton.onclick = async() => {
    muteAudioButton.innerText  = isAudioMuted ? 'Mute Audio' : 'Unmute Audio';
    localStream.getAudioTracks()[0].enabled = isAudioMuted;
    isAudioMuted = !isAudioMuted;
}

muteVideoButton.onclick = async() => {
    muteVideoButton.innerText = isVideoMuted ? 'Mute Video' : 'Unmute Video';
    localStream.getVideoTracks()[0].enabled = isVideoMuted;
    isVideoMuted = !isVideoMuted;
}

acceptButton.onclick = async () => {
    user = 'user2';
    console.log('1.1 -> call accepted...');
    console.log('1.2 -> getting self stream for user2');
    localStream = await navigator.mediaDevices.getUserMedia({audio: true, video: false});
    localVideo.srcObject = localStream;
  
  
    callButton.disabled = true;
    acceptButton.disabled = true;
    hangupButton.disabled = false;
    console.log('1.3 -> broadcasting accepted');
    webSocket.send(JSON.stringify({type: 'accepted'}));
};
  

hangupButton.onclick = async () => {
  hangup();
  console.log('broadcasting bye');
  webSocket.send(JSON.stringify({type: 'bye'}));
};

async function hangup() {
  if (pc) {
    pc.close();
    pc = null;
  }
  localStream.getTracks().forEach(track => track.stop());
  localStream = null;
  callButton.disabled = false;
  acceptButton.disabled = false;
  hangupButton.disabled = true;
};

function createPeerConnection() {
  pc = new RTCPeerConnection();
  pc.onicecandidate = e => {
    const message = {
      type: 'candidate',
      candidate: null,
    };
    if (e.candidate) {
      message.candidate = e.candidate.candidate;
      message.sdpMid = e.candidate.sdpMid;
      message.sdpMLineIndex = e.candidate.sdpMLineIndex;
    }
    console.log(`${user === 'user1' ? 3.1 : 4.1} -> broadcasting candidates`);
    webSocket.send(JSON.stringify(message));
  };
  pc.ontrack = e => {
    console.log(`received remote stream`);
    remoteVideo.srcObject = e.streams[0];
  }
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
}

async function onCallAccepted() {
  console.log('2.1 -> in onCallAccepted');
  console.log('2.2 -> creating peer connection for outgoing stream');
  await createPeerConnection();

  const offer = await pc.createOffer();
  console.log('2.3 -> sending offer');
  webSocket.send(JSON.stringify({type: 'offer', sdp: offer.sdp}));
  console.log('2.4 -> setting local description');
  await pc.setLocalDescription(offer);
}

async function onSdpOfferReceived(offer) {
  console.log('2.1 -> in onSdpOfferReceived');
  if (!pc) {
    console.log('2.2. -> creating peer connection for incoming stream');
    await createPeerConnection();
  }
  console.log('2.3 -> setting remote description');
  await pc.setRemoteDescription(offer);

  const answer = await pc.createAnswer();
  console.log('2.4 -> broadcasting answer');
  webSocket.send(JSON.stringify({type: 'answer', sdp: answer.sdp}));
  await pc.setLocalDescription(answer);
}

async function onSdpAnswerReceived(answer) {
  if (!pc) {
    console.error('no peerconnection');
    return;
  }
  console.log('4.1 -> setting remote description');
  await pc.setRemoteDescription(answer);
}

async function onIceCandidateReceived(candidate) {
  console.log(`${user === 'user1' ? 5.1 : 3.1} -> in onIceCandidateReceived`);
  if (!pc) {
    console.error('no peerconnection');
    return;
  }
  if (!candidate.candidate) {
    await pc.addIceCandidate(null);
  } else {
    await pc.addIceCandidate(candidate);
  }
}
