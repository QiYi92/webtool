from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session


def get_user_by_identifier(db: Session, identifier: str) -> Optional[dict]:
    result = db.execute(
        text(
            """
            select id, username, email, password_hash, role_group
            from app_users
            where lower(email) = lower(:identifier)
               or lower(username) = lower(:identifier)
            limit 1
            """
        ),
        {"identifier": identifier}
    )
    return result.mappings().first()


def get_user_by_id(db: Session, user_id: str) -> Optional[dict]:
    result = db.execute(
        text(
            """
            select id, username, email, role_group
            from app_users
            where id = :user_id
            limit 1
            """
        ),
        {"user_id": user_id}
    )
    return result.mappings().first()


def get_user_with_password(db: Session, user_id: str) -> Optional[dict]:
    result = db.execute(
        text(
            """
            select id, username, email, password_hash, role_group
            from app_users
            where id = :user_id
            limit 1
            """
        ),
        {"user_id": user_id}
    )
    return result.mappings().first()


def update_user_account(db: Session, user_id: str, username: str, email: str) -> Optional[dict]:
    result = db.execute(
        text(
            """
            update app_users
            set username = :username,
                email = :email,
                updated_at = now()
            where id = :user_id
            returning id, username, email, role_group
            """
        ),
        {"user_id": user_id, "username": username, "email": email}
    )
    db.commit()
    return result.mappings().first()


def update_user_password(db: Session, user_id: str, password_hash: str) -> None:
    db.execute(
        text(
            """
            update app_users
            set password_hash = :password_hash,
                updated_at = now()
            where id = :user_id
            """
        ),
        {"user_id": user_id, "password_hash": password_hash}
    )
    db.commit()


def list_users(db: Session, query: str | None = None) -> list[dict]:
    base_sql = """
        select id, username, email, role_group, created_at, updated_at
        from app_users
    """
    params: dict[str, object] = {}
    if query:
        base_sql += " where lower(username) like :q or lower(email) like :q"
        params["q"] = f"%{query.lower()}%"
    base_sql += " order by created_at desc"
    result = db.execute(text(base_sql), params)
    return list(result.mappings().all())


def get_user_role(db: Session, user_id: str) -> Optional[str]:
    result = db.execute(
        text(
            """
            select role_group
            from app_users
            where id = :user_id
            limit 1
            """
        ),
        {"user_id": user_id}
    )
    row = result.first()
    return row[0] if row else None


def create_user(
    db: Session,
    username: str,
    email: str,
    password_hash: str,
    role_group: str,
) -> Optional[dict]:
    result = db.execute(
        text(
            """
            insert into app_users (id, username, email, password_hash, role_group, created_at, updated_at)
            values (gen_random_uuid(), :username, :email, :password_hash, :role_group, now(), now())
            returning id, username, email, role_group, created_at, updated_at
            """
        ),
        {
            "username": username,
            "email": email,
            "password_hash": password_hash,
            "role_group": role_group
        }
    )
    db.commit()
    return result.mappings().first()


def update_user(
    db: Session,
    user_id: str,
    username: str,
    email: str,
    role_group: str,
    password_hash: Optional[str],
) -> Optional[dict]:
    if password_hash:
        sql = """
            update app_users
            set username = :username,
                email = :email,
                role_group = :role_group,
                password_hash = :password_hash,
                updated_at = now()
            where id = :user_id
            returning id, username, email, role_group, created_at, updated_at
        """
        params = {
            "user_id": user_id,
            "username": username,
            "email": email,
            "role_group": role_group,
            "password_hash": password_hash
        }
    else:
        sql = """
            update app_users
            set username = :username,
                email = :email,
                role_group = :role_group,
                updated_at = now()
            where id = :user_id
            returning id, username, email, role_group, created_at, updated_at
        """
        params = {
            "user_id": user_id,
            "username": username,
            "email": email,
            "role_group": role_group
        }

    result = db.execute(text(sql), params)
    db.commit()
    return result.mappings().first()


def delete_user(db: Session, user_id: str) -> bool:
    result = db.execute(
        text(
            """
            delete from app_users
            where id = :user_id
            """
        ),
        {"user_id": user_id}
    )
    db.commit()
    return result.rowcount > 0
