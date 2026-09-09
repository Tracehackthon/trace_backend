"""Small Python client for the Trace runtime JSONL RPC boundary.

The client intentionally launches an explicitly supplied runtime command. It
does not discover Node, read a default home, or import TypeScript internals.
"""

from .client import TraceRuntime, RuntimeRpcError

__all__ = ["TraceRuntime", "RuntimeRpcError"]
