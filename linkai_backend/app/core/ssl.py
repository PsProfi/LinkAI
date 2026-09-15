import ipaddress
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, Tuple

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from app.core.config import settings


def generate_self_signed_cert(cert_dir: Path) -> Tuple[str, str]:
    """Generate a self-signed development certificate and key for localhost."""
    cert_dir.mkdir(parents=True, exist_ok=True)
    cert_path = cert_dir / "cert.pem"
    key_path = cert_dir / "key.pem"

    if cert_path.exists() and key_path.exists():
        return str(key_path.resolve()), str(cert_path.resolve())

    # Generate RSA private key
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )

    # Subject and Issuer
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "UA"),
        x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "Kyiv"),
        x509.NameAttribute(NameOID.LOCALITY_NAME, "Kyiv"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "LinkAI"),
        x509.NameAttribute(NameOID.COMMON_NAME, "localhost"),
    ])

    # SANs (Subject Alternative Names) for localhost, 127.0.0.1, 0.0.0.0
    alt_names = [
        x509.DNSName("localhost"),
        x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
        x509.IPAddress(ipaddress.IPv4Address("0.0.0.0")),
    ]

    now = datetime.now(timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + timedelta(days=365))
        .add_extension(
            x509.SubjectAlternativeName(alt_names),
            critical=False,
        )
        .sign(private_key, hashes.SHA256())
    )

    # Write private key
    with open(key_path, "wb") as f:
        f.write(
            private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )

    # Write certificate
    with open(cert_path, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    return str(key_path.resolve()), str(cert_path.resolve())


def get_ssl_context_files() -> Tuple[Optional[str], Optional[str]]:
    """Return tuple of (ssl_keyfile, ssl_certfile) based on configuration.
    
    Returns (None, None) if HTTPS_ENABLED is False.
    """
    if not settings.HTTPS_ENABLED:
        return None, None

    # Use explicit custom files if provided and exist
    if settings.SSL_KEYFILE and settings.SSL_CERTFILE:
        if os.path.exists(settings.SSL_KEYFILE) and os.path.exists(settings.SSL_CERTFILE):
            return settings.SSL_KEYFILE, settings.SSL_CERTFILE

    # Otherwise auto-generate self-signed cert in cert_dir
    backend_root = Path(__file__).resolve().parent.parent.parent
    cert_dir = backend_root / settings.SSL_CERT_DIR
    return generate_self_signed_cert(cert_dir)
