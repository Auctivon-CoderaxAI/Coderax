import subprocess
import sys
from pathlib import Path


SCRIPT = Path(__file__).with_name("update_env.py")


def test_replaces_placeholders_and_preserves_other_lines(tmp_path, monkeypatch):
    source = tmp_path / "input.env"
    output = tmp_path / "output.env"
    source.write_text("# Config\nAPP_TOKEN=GET_FROM_LOCAL_ENV\nPORT=3080\n")
    monkeypatch.setenv("APP_TOKEN", "synthetic-value")

    subprocess.run([sys.executable, str(SCRIPT), str(source), str(output)], check=True)

    assert output.read_text() == "# Config\nAPP_TOKEN=synthetic-value\nPORT=3080\n"


def test_missing_variable_fails_without_overwriting_output(tmp_path, monkeypatch):
    source = tmp_path / "input.env"
    output = tmp_path / "output.env"
    source.write_text("APP_TOKEN=GET_FROM_LOCAL_ENV\n")
    output.write_text("PORT=3080\n")
    monkeypatch.delenv("APP_TOKEN", raising=False)

    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(source), str(output)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 1
    assert "could not find APP_TOKEN" in result.stdout
    assert output.read_text() == "PORT=3080\n"
