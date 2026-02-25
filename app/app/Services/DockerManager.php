<?php

namespace App\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class DockerManager
{
    private readonly string $baseUrl;

    public function __construct(
        private readonly string $socketPath,
        private readonly string $containerName,
    ) {
        $this->baseUrl = 'http://localhost';
    }

    public function getContainerStatus(): array
    {
        $response = $this->request('GET', "/containers/{$this->containerName}/json");

        if ($response === null) {
            return [
                'exists' => false,
                'running' => false,
                'status' => 'not_found',
            ];
        }

        $state = $response['State'] ?? [];

        return [
            'exists' => true,
            'running' => $state['Running'] ?? false,
            'status' => $state['Status'] ?? 'unknown',
            'started_at' => $state['StartedAt'] ?? null,
            'finished_at' => $state['FinishedAt'] ?? null,
            'restart_count' => $response['RestartCount'] ?? 0,
        ];
    }

    public function startContainer(): bool
    {
        $response = $this->request('POST', "/containers/{$this->containerName}/start");

        return $response !== null;
    }

    public function stopContainer(int $timeout = 30): bool
    {
        $response = $this->request('POST', "/containers/{$this->containerName}/stop", [
            'query' => ['t' => $timeout],
        ]);

        return $response !== null;
    }

    public function restartContainer(int $timeout = 30): bool
    {
        $response = $this->request('POST', "/containers/{$this->containerName}/restart", [
            'query' => ['t' => $timeout],
        ]);

        return $response !== null;
    }

    public function getContainerLogs(int $tail = 100, ?string $since = null): array
    {
        $query = [
            'stdout' => true,
            'stderr' => true,
            'tail' => $tail,
            'timestamps' => true,
        ];

        if ($since !== null) {
            $query['since'] = $since;
        }

        $response = $this->requestRaw('GET', "/containers/{$this->containerName}/logs", [
            'query' => $query,
        ]);

        if ($response === null) {
            return [];
        }

        return $this->parseLogOutput($response);
    }

    private function request(string $method, string $path, array $options = []): ?array
    {
        try {
            $client = Http::baseUrl($this->baseUrl)
                ->withOptions([
                    'curl' => [
                        CURLOPT_UNIX_SOCKET_PATH => $this->socketPath,
                    ],
                ]);

            $url = $path;
            if (isset($options['query'])) {
                $url .= '?'.http_build_query($options['query']);
            }

            $response = match (strtoupper($method)) {
                'GET' => $client->get($url),
                'POST' => $client->post($url, $options['body'] ?? []),
                'DELETE' => $client->delete($url),
                default => throw new RuntimeException("Unsupported HTTP method: {$method}"),
            };

            if ($response->status() === 404) {
                return null;
            }

            if ($response->status() === 204 || $response->status() === 304) {
                return [];
            }

            if ($response->successful()) {
                return $response->json() ?? [];
            }

            return null;
        } catch (ConnectionException) {
            throw new RuntimeException("Cannot connect to Docker daemon at {$this->socketPath}");
        }
    }

    private function requestRaw(string $method, string $path, array $options = []): ?string
    {
        try {
            $client = Http::baseUrl($this->baseUrl)
                ->withOptions([
                    'curl' => [
                        CURLOPT_UNIX_SOCKET_PATH => $this->socketPath,
                    ],
                ]);

            $url = $path;
            if (isset($options['query'])) {
                $url .= '?'.http_build_query($options['query']);
            }

            $response = $client->get($url);

            if ($response->successful()) {
                return $response->body();
            }

            return null;
        } catch (ConnectionException) {
            return null;
        }
    }

    private function parseLogOutput(string $raw): array
    {
        $lines = [];

        // Docker multiplexed log stream: 8-byte header per frame
        $offset = 0;
        $length = strlen($raw);

        while ($offset < $length) {
            if ($offset + 8 > $length) {
                // Remaining data is less than header, treat as plain text
                $lines = array_merge($lines, array_filter(explode("\n", substr($raw, $offset))));
                break;
            }

            $header = unpack('Ctype/x3/Nsize', substr($raw, $offset, 8));

            if ($header === false || $header['size'] === 0) {
                $offset += 8;

                continue;
            }

            $frameSize = $header['size'];

            if ($offset + 8 + $frameSize > $length) {
                // Incomplete frame, take what we can
                $lines[] = trim(substr($raw, $offset + 8));
                break;
            }

            $content = trim(substr($raw, $offset + 8, $frameSize));
            if ($content !== '') {
                $lines[] = $content;
            }

            $offset += 8 + $frameSize;
        }

        return $lines;
    }
}
