<?php

namespace App\Services;

use RuntimeException;

class RconClient
{
    private const SERVERDATA_AUTH = 3;

    private const SERVERDATA_AUTH_RESPONSE = 2;

    private const SERVERDATA_EXECCOMMAND = 2;

    private const SERVERDATA_RESPONSE_VALUE = 0;

    private $socket = null;

    private int $requestId = 0;

    private bool $authenticated = false;

    public function __construct(
        private readonly string $host,
        private readonly int $port,
        private readonly string $password,
        private readonly int $timeout,
    ) {}

    public function connect(): void
    {
        if ($this->socket !== null) {
            return;
        }

        $this->socket = @socket_create(AF_INET, SOCK_STREAM, SOL_TCP);

        if ($this->socket === false) {
            throw new RuntimeException('Failed to create socket: '.socket_strerror(socket_last_error()));
        }

        socket_set_option($this->socket, SOL_SOCKET, SO_RCVTIMEO, [
            'sec' => $this->timeout,
            'usec' => 0,
        ]);

        socket_set_option($this->socket, SOL_SOCKET, SO_SNDTIMEO, [
            'sec' => $this->timeout,
            'usec' => 0,
        ]);

        $connected = @socket_connect($this->socket, $this->host, $this->port);

        if ($connected === false) {
            $error = socket_strerror(socket_last_error($this->socket));
            $this->close();
            throw new RuntimeException("Failed to connect to RCON at {$this->host}:{$this->port}: {$error}");
        }

        $this->authenticate();
    }

    public function command(string $command): string
    {
        $this->ensureConnected();

        $requestId = $this->nextRequestId();
        $this->sendPacket($requestId, self::SERVERDATA_EXECCOMMAND, $command);

        $response = $this->readPacket();

        if ($response === null) {
            throw new RuntimeException('No response received from RCON server');
        }

        return $response['body'];
    }

    public function isConnected(): bool
    {
        return $this->socket !== null && $this->authenticated;
    }

    public function close(): void
    {
        if ($this->socket !== null) {
            @socket_close($this->socket);
            $this->socket = null;
        }
        $this->authenticated = false;
    }

    public function reconnect(): void
    {
        $this->close();
        $this->connect();
    }

    private function authenticate(): void
    {
        $requestId = $this->nextRequestId();
        $this->sendPacket($requestId, self::SERVERDATA_AUTH, $this->password);

        $response = $this->readPacket();

        if ($response === null || $response['id'] === -1) {
            $this->close();
            throw new RuntimeException('RCON authentication failed');
        }

        $this->authenticated = true;
    }

    private function ensureConnected(): void
    {
        if (! $this->isConnected()) {
            $this->connect();
        }
    }

    private function sendPacket(int $requestId, int $type, string $body): void
    {
        $packet = pack('VV', $requestId, $type).$body."\x00\x00";
        $packet = pack('V', strlen($packet)).$packet;

        $totalSent = 0;
        $packetLength = strlen($packet);

        while ($totalSent < $packetLength) {
            $sent = @socket_write($this->socket, substr($packet, $totalSent), $packetLength - $totalSent);

            if ($sent === false) {
                throw new RuntimeException('Failed to send RCON packet: '.socket_strerror(socket_last_error($this->socket)));
            }

            $totalSent += $sent;
        }
    }

    private function readPacket(): ?array
    {
        $sizeData = $this->readBytes(4);

        if ($sizeData === null) {
            return null;
        }

        $size = unpack('V', $sizeData)[1];

        if ($size < 10 || $size > 4096) {
            throw new RuntimeException("Invalid RCON packet size: {$size}");
        }

        $body = $this->readBytes($size);

        if ($body === null) {
            return null;
        }

        $unpacked = unpack('Vid/Vtype', $body);

        return [
            'id' => $unpacked['id'] === 4294967295 ? -1 : $unpacked['id'],
            'type' => $unpacked['type'],
            'body' => substr($body, 8, -2),
        ];
    }

    private function readBytes(int $length): ?string
    {
        $data = '';
        $remaining = $length;

        while ($remaining > 0) {
            $chunk = @socket_read($this->socket, $remaining);

            if ($chunk === false || $chunk === '') {
                return null;
            }

            $data .= $chunk;
            $remaining -= strlen($chunk);
        }

        return $data;
    }

    private function nextRequestId(): int
    {
        return ++$this->requestId;
    }
}
