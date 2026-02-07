import os


def get_openalex_email():
    email = os.getenv("OPENALEX_EMAIL", "").strip()
    if email:
        return email

    try:
        from local_config import OPENALEX_EMAIL
    except ImportError as exc:
        raise RuntimeError(
            "OpenAlex email is missing. Set OPENALEX_EMAIL or create data/local_config.py "
            "from data/local_config.example.py."
        ) from exc

    email = (OPENALEX_EMAIL or "").strip()
    if not email:
        raise RuntimeError("OPENALEX_EMAIL in data/local_config.py is empty.")

    return email
