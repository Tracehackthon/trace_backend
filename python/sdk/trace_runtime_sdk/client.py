from __future__ import annotations

import json
import subprocess
import threading
import uuid
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


class RuntimeRpcError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class TraceRuntime:
    """Drive a Trace TypeScript runtime over newline-delimited JSON-RPC.

    ``command`` must be a complete, caller-owned argv (for example a packaged
    native runtime or ``node dist/packages/sdk/server/src/main.js --sqlite-state-file <db>``). The SDK is only a
    transport/client layer; state and validation remain in the TS runtime.
    """

    def __init__(
        self,
        command: Sequence[str],
        *,
        cwd: str | Path | None = None,
        env: Mapping[str, str] | None = None,
    ) -> None:
        if not command or any(not item for item in command):
            raise ValueError("command must be a non-empty executable argv")
        self._command = list(command)
        self._cwd = str(cwd) if cwd is not None else None
        self._env = dict(env) if env is not None else None
        self._process: subprocess.Popen[str] | None = None
        self._lock = threading.Lock()
        self._sequence = 0

    def _start(self) -> subprocess.Popen[str]:
        if self._process is None:
            self._process = subprocess.Popen(
                self._command,
                cwd=self._cwd,
                env=self._env,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                bufsize=1,
            )
        return self._process

    def request(self, method: str, params: Mapping[str, Any]) -> Any:
        with self._lock:
            process = self._start()
            if process.stdin is None or process.stdout is None:
                raise RuntimeRpcError("TRANSPORT_CLOSED", "Trace runtime streams are unavailable")
            self._sequence += 1
            request_id = f"py-{self._sequence}-{uuid.uuid4().hex[:8]}"
            process.stdin.write(json.dumps({"id": request_id, "method": method, "params": params}, ensure_ascii=False) + "\n")
            process.stdin.flush()
            line = process.stdout.readline()
            if not line:
                raise RuntimeRpcError("TRANSPORT_CLOSED", "Trace runtime exited before replying")
            value = json.loads(line)
            if value.get("id") != request_id:
                raise RuntimeRpcError("PROTOCOL_ERROR", "RPC response id does not match request")
            if "error" in value:
                error = value["error"]
                raise RuntimeRpcError(str(error.get("code", "RPC_ERROR")), str(error.get("message", "Runtime request failed")))
            return value.get("result")

    def create_change(self, payload: Mapping[str, Any]) -> Any:
        return self.request("change.create", payload)

    def update_change(self, change_id: str, payload: Mapping[str, Any]) -> Any:
        return self.request("change.update", {"change_id": change_id, **payload})

    def list_changes(self, status: str | None = None) -> Any:
        return self.request("change.list", {} if status is None else {"status": status})

    def create_data(self, payload: Mapping[str, Any]) -> Any:
        return self.request("data.create", payload)

    def update_data(self, record_id: str, payload: Mapping[str, Any]) -> Any:
        return self.request("data.update", {"record_id": record_id, **payload})

    def list_data(self, kind: str | None = None) -> Any:
        return self.request("data.list", {} if kind is None else {"kind": kind})

    def verify_data_chain(self, record_id: str) -> Any:
        return self.request("data.verify", {"record_id": record_id})

    def create_thread(self, payload: Mapping[str, Any]) -> Any:
        return self.request("continuity.thread.create", payload)

    def update_thread(self, thread_id: str, payload: Mapping[str, Any]) -> Any:
        return self.request("continuity.thread.update", {"thread_id": thread_id, **payload})

    def append_discussion_turn(self, payload: Mapping[str, Any]) -> Any:
        return self.request("continuity.turn.create", payload)

    def create_receipt(self, payload: Mapping[str, Any]) -> Any:
        return self.request("continuity.receipt.create", payload)

    def list_continuity(self, thread_id: str | None = None) -> Any:
        return self.request("continuity.list", {} if thread_id is None else {"thread_id": thread_id})

    def close(self) -> None:
        process, self._process = self._process, None
        if process is None:
            return
        if process.stdin is not None:
            process.stdin.close()
        process.wait(timeout=5)

    def __enter__(self) -> "TraceRuntime":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
