"""
Convert a PPTX to PDF.

In the Trigger.dev cloud runtime (Linux), uses LibreOffice (`soffice --headless`).
On local Windows dev, falls back to PowerPoint COM.

Usage: python convert_pdf.py <input.pptx> <output.pdf>
"""
import sys
import os
import shutil
import subprocess


def convert_with_libreoffice(src: str, dst: str) -> bool:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return False
    out_dir = os.path.dirname(os.path.abspath(dst))
    os.makedirs(out_dir, exist_ok=True)
    cmd = [soffice, "--headless", "--convert-to", "pdf", "--outdir", out_dir, src]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            print("[libreoffice]", proc.stderr, file=sys.stderr)
            return False
        # LibreOffice writes <basename>.pdf to outdir
        base = os.path.splitext(os.path.basename(src))[0]
        produced = os.path.join(out_dir, base + ".pdf")
        if produced != dst and os.path.exists(produced):
            shutil.move(produced, dst)
        return os.path.exists(dst)
    except Exception as e:
        print("[libreoffice]", e, file=sys.stderr)
        return False


def convert_with_powerpoint_com(src: str, dst: str) -> bool:
    """Try Python COM first (comtypes / pywin32). Fall back to PowerShell."""
    # Python COM path
    ppt = None
    try:
        try:
            import comtypes.client  # type: ignore
            ppt = comtypes.client.CreateObject("PowerPoint.Application")
        except ImportError:
            try:
                import win32com.client  # type: ignore
                ppt = win32com.client.Dispatch("PowerPoint.Application")
            except ImportError:
                ppt = None
        if ppt is not None:
            try:
                ppt.Visible = 1
                pres = ppt.Presentations.Open(os.path.abspath(src), WithWindow=False)
                pres.SaveAs(os.path.abspath(dst), 32)  # 32 = ppSaveAsPDF
                pres.Close()
                ppt.Quit()
                if os.path.exists(dst):
                    return True
            except Exception as e:
                print("[powerpoint-py]", e, file=sys.stderr)
                try:
                    ppt.Quit()
                except Exception:
                    pass
    except Exception as e:
        print("[powerpoint-py-init]", e, file=sys.stderr)

    # PowerShell fallback (does not need pywin32 / comtypes)
    src_abs = os.path.abspath(src).replace("'", "''")
    dst_abs = os.path.abspath(dst).replace("'", "''")
    ps_script = (
        "$ErrorActionPreference='Stop';"
        "$pp = New-Object -ComObject PowerPoint.Application;"
        "$pp.Visible = [Microsoft.Office.Core.MsoTriState]::msoTrue;"
        f"$pres = $pp.Presentations.Open('{src_abs}', $true, $true, $false);"
        f"$pres.SaveAs('{dst_abs}', 32);"
        "$pres.Close();"
        "$pp.Quit();"
    )
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
            capture_output=True, text=True, timeout=180,
        )
        if proc.returncode != 0:
            print("[powerpoint-ps]", proc.stderr, file=sys.stderr)
        return os.path.exists(dst)
    except Exception as e:
        print("[powerpoint-ps]", e, file=sys.stderr)
        return False


def main():
    if len(sys.argv) < 3:
        print("Usage: convert_pdf.py <input.pptx> <output.pdf>", file=sys.stderr)
        sys.exit(2)
    src, dst = sys.argv[1], sys.argv[2]
    if not os.path.exists(src):
        print(f"Input not found: {src}", file=sys.stderr)
        sys.exit(2)
    if convert_with_libreoffice(src, dst):
        print(f"Converted via LibreOffice: {dst}")
        return
    if os.name == "nt" and convert_with_powerpoint_com(src, dst):
        print(f"Converted via PowerPoint: {dst}")
        return
    print("No PDF converter available (LibreOffice or PowerPoint required)", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
