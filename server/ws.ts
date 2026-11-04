import http from 'node:http';
import crypto from 'node:crypto';
import EventEmitter from 'node:events';

export interface CustomWebSocket extends EventEmitter {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  isAlive: boolean;
}

export class MiniWebSocketServer extends EventEmitter {
  private server: http.Server;

  constructor(server: http.Server) {
    super();
    this.server = server;
    this.server.on('upgrade', this.handleUpgrade.bind(this));
  }

  private handleUpgrade(req: http.IncomingMessage, socket: any, head: Buffer) {
    const upgradeHeader = req.headers['upgrade'];
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      socket.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const digest = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${digest}`,
      '',
      '',
    ];

    socket.write(headers.join('\r\n'));

    const ws = new (EventEmitter as any)() as CustomWebSocket;
    ws.isAlive = true;

    ws.send = (text: string) => {
      if (socket.destroyed || !socket.writable) return;
      const payload = Buffer.from(text, 'utf8');
      const len = payload.length;
      let header: Buffer;

      if (len <= 125) {
        header = Buffer.alloc(2);
        header[0] = 0x81; // FIN + text opcode
        header[1] = len;
      } else if (len <= 65535) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
      }

      socket.write(Buffer.concat([header, payload]));
    };

    ws.close = () => {
      if (socket.destroyed) return;
      // Close frame
      const frame = Buffer.from([0x88, 0x00]);
      socket.write(frame, () => {
        socket.end();
      });
    };

    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 2) {
        const firstByte = buffer[0];
        const secondByte = buffer[1];
        const opcode = firstByte & 0x0f;
        const isMasked = (secondByte & 0x80) !== 0;
        let payloadLen = secondByte & 0x7f;
        let offset = 2;

        if (payloadLen === 126) {
          if (buffer.length < 4) break;
          payloadLen = buffer.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (buffer.length < 10) break;
          payloadLen = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }

        const maskLen = isMasked ? 4 : 0;
        const totalFrameLen = offset + maskLen + payloadLen;

        if (buffer.length < totalFrameLen) {
          break; // wait for more data
        }

        let maskingKey: Buffer | null = null;
        if (isMasked) {
          maskingKey = buffer.subarray(offset, offset + 4);
          offset += 4;
        }

        const rawPayload = buffer.subarray(offset, offset + payloadLen);
        const unmasked = Buffer.alloc(payloadLen);

        if (isMasked && maskingKey) {
          for (let i = 0; i < payloadLen; i++) {
            unmasked[i] = rawPayload[i] ^ maskingKey[i % 4];
          }
        } else {
          rawPayload.copy(unmasked);
        }

        // Advance buffer
        buffer = buffer.subarray(totalFrameLen);

        if (opcode === 0x8) {
          // Close frame
          ws.emit('close');
          ws.close();
          return;
        } else if (opcode === 0x9) {
          // Ping frame -> send pong
          const pong = Buffer.from([0x8a, 0x00]);
          socket.write(pong);
        } else if (opcode === 0x1) {
          // Text frame
          const message = unmasked.toString('utf8');
          ws.emit('message', message);
        }
      }
    });

    socket.on('error', (err: any) => {
      ws.emit('error', err);
    });

    socket.on('close', () => {
      ws.isAlive = false;
      ws.emit('close');
    });

    this.emit('connection', ws, req);
  }
}
