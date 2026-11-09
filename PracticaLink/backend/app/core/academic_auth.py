"""401 for missing/malformed bearer headers without changing legacy auth contracts.
The existing get_current_user_id dependency performs the actual JWT validation.
"""
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_bearer = HTTPBearer(auto_error=False)


def require_academic_bearer(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)):
    if credentials is None:
        raise HTTPException(401, 'Autenticación requerida', headers={'WWW-Authenticate': 'Bearer'})
