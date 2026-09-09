import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python" / "sdk"))
from trace_runtime_sdk import RuntimeRpcError, TraceRuntime


def test_python_sdk_rejects_empty_command():
    with pytest.raises(ValueError):
        TraceRuntime([])


def test_python_sdk_round_trip_uses_the_ts_rpc_boundary(tmp_path):
    helper = tmp_path / "rpc_helper.py"
    helper.write_text(
        "import json, sys\n"
        "for line in sys.stdin:\n"
        "    request = json.loads(line)\n"
        "    print(json.dumps({'id': request['id'], 'result': {'method': request['method'], 'ok': True}}), flush=True)\n",
        encoding="utf-8",
    )
    with TraceRuntime([sys.executable, str(helper)]) as client:
        assert client.request("ping", {}) == {"method": "ping", "ok": True}


def test_python_sdk_maps_error_responses(tmp_path):
    helper = tmp_path / "rpc_error.py"
    helper.write_text(
        "import json, sys\n"
        "request = json.loads(sys.stdin.readline())\n"
        "print(json.dumps({'id': request['id'], 'error': {'code': 'DENIED', 'message': 'not allowed'}}), flush=True)\n",
        encoding="utf-8",
    )
    with TraceRuntime([sys.executable, str(helper)]) as client:
        with pytest.raises(RuntimeRpcError, match="not allowed") as error:
            client.request("private.write", {})
        assert error.value.code == "DENIED"
