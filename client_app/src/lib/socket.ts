import { io } from 'socket.io-client';

export const socket = io('https://staywelldentalbackend.onrender.com', {
  autoConnect: true
});

socket.on('connect', () => {
  console.log('Connected to socket server');
});

socket.on('disconnect', () => {
  console.log('Disconnected from socket server');
});

socket.on('connect_error', error => {
  console.error('Socket connection error:', error);
});

export default socket;
