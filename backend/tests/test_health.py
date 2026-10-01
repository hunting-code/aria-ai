"""Smoke tests: the service starts, and a user can register and sign in."""

from __future__ import annotations


class TestHealth:
    def test_health_returns_200(self, client):
        response = client.get("/health")
        assert response.status_code == 200

    def test_health_reports_a_connected_database(self, client):
        body = client.get("/health").json()
        # "ok" requires the database to answer; "degraded" means it did not.
        assert body["status"] == "ok", body
        assert body["database"] == "connected", body
        assert body["version"]

    def test_root_names_the_service(self, client):
        body = client.get("/").json()
        assert body["service"]


class TestRegister:
    def test_register_returns_a_token(self, client, unique_user):
        response = client.post("/api/auth/register", json=unique_user)
        assert response.status_code in (200, 201), response.text
        body = response.json()
        assert body["access_token"]
        assert body["token_type"].lower() == "bearer"

    def test_register_rejects_a_duplicate_username(self, client, unique_user):
        assert client.post("/api/auth/register", json=unique_user).status_code in (200, 201)
        again = client.post(
            "/api/auth/register",
            json={**unique_user, "email": f"other-{unique_user['email']}"},
        )
        assert again.status_code in (400, 409), again.text

    def test_register_rejects_a_short_password(self, client, unique_user):
        response = client.post(
            "/api/auth/register", json={**unique_user, "password": "short"}
        )
        assert response.status_code == 422

    def test_the_password_is_never_echoed_back(self, client, unique_user):
        # A failed registration must not reflect the submitted password.
        response = client.post(
            "/api/auth/register", json={**unique_user, "email": "not-an-email"}
        )
        assert response.status_code == 422
        assert unique_user["password"] not in response.text


class TestLogin:
    def test_login_with_correct_credentials(self, client, unique_user):
        client.post("/api/auth/register", json=unique_user)
        response = client.post(
            "/api/auth/login",
            data={
                "username": unique_user["username"],
                "password": unique_user["password"],
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["access_token"]

    def test_login_with_a_wrong_password_is_rejected(self, client, unique_user):
        client.post("/api/auth/register", json=unique_user)
        response = client.post(
            "/api/auth/login",
            data={"username": unique_user["username"], "password": "WrongPass123!"},
        )
        assert response.status_code == 401

    def test_login_for_an_unknown_user_is_rejected(self, client):
        response = client.post(
            "/api/auth/login",
            data={"username": "nobody-at-all", "password": "TestPass123!"},
        )
        assert response.status_code == 401

    def test_the_token_authenticates_against_me(self, client, unique_user):
        token = client.post("/api/auth/register", json=unique_user).json()["access_token"]
        me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json()["username"] == unique_user["username"]
        # The hash must never leave the server.
        assert "hashed_password" not in me.text

    def test_me_without_a_token_is_rejected(self, client):
        assert client.get("/api/auth/me").status_code == 401
