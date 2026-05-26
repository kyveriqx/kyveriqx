"use client";
import { useState, useRef, DragEvent } from "react";
import { useRouter } from "next/navigation";
import {
  useAppStore,
  FILE_SECTIONS,
  FileSection,
  UploadedFile,
} from "@orgmis/lib/store";
import { Card, Button, Badge } from "@orgmis/components/ui";
import { cn, formatBytes } from "@orgmis/lib/utils";
import {
  ArrowRight,
  ArrowLeft,
  Upload as UploadIcon,
  FileSpreadsheet,
  CheckCircle2,
  X,
  AlertCircle,
  Plus,
} from "lucide-react";

export default function UploadPage() {
  const router = useRouter();
  const files = useAppStore((s) => s.files);
  const addFile = useAppStore((s) => s.addFile);
  const removeFile = useAppStore((s) => s.removeFile);

  // Defensive: legacy shape stored single object; new shape is array
  const asList = (v: any): UploadedFile[] =>
    Array.isArray(v) ? v : v && typeof v === "object" && v.id ? [v] : [];

  const requiredOk = asList(files.glOrTrialBalance).length > 0;
  const totalUploaded = Object.values(files).reduce(
    (n, v) => n + asList(v).length,
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Upload your data</h1>
          <p className="text-slate-500 mt-1">
            Drop your ERP exports below. Each section accepts <strong>multiple files</strong> —
            useful when your data is split across months or entities.
          </p>
        </div>
        <Badge tone="brand">Step 2 of 4</Badge>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {FILE_SECTIONS.map((sec) => (
          <UploadSection
            key={sec.key}
            section={sec.key}
            title={sec.title}
            description={sec.description}
            examples={sec.examples}
            required={sec.required}
            fileList={asList(files[sec.key])}
            onAdd={(f) => addFile(sec.key, f)}
            onRemove={(id) => removeFile(sec.key, id)}
          />
        ))}
      </div>

      {/* Bottom action bar */}
      <div className="sticky bottom-4 bg-white border border-slate-200 rounded-xl shadow-lg p-4 flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm">
          {requiredOk ? (
            <>
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span className="text-slate-700">
                <strong>{totalUploaded}</strong> file{totalUploaded !== 1 && "s"} ready to process
              </span>
            </>
          ) : (
            <>
              <AlertCircle className="w-5 h-5 text-amber-500" />
              <span className="text-slate-700">
                Please upload at least one <strong>GL Entry / Trial Balance</strong> file to
                continue
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => router.push("/tools/orgmis/settings")}>
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          <Button
            size="lg"
            disabled={!requiredOk}
            onClick={() => router.push("/tools/orgmis/preview")}
          >
            Preview KPIs
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function UploadSection({
  section,
  title,
  description,
  examples,
  required,
  fileList,
  onAdd,
  onRemove,
}: {
  section: FileSection;
  title: string;
  description: string;
  examples: string;
  required: boolean;
  fileList: UploadedFile[];
  onAdd: (f: UploadedFile) => void;
  onRemove: (id: string) => void;
}) {
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(fs: FileList | File[]) {
    setErrors([]);
    const list = Array.from(fs);
    if (list.length === 0) return;
    setUploading(true);
    const errs: string[] = [];
    for (const f of list) {
      if (!/\.(xlsx|xls)$/i.test(f.name)) {
        errs.push(`${f.name}: only .xlsx or .xls accepted`);
        continue;
      }
      if (f.size > 20 * 1024 * 1024) {
        errs.push(`${f.name}: must be under 20 MB`);
        continue;
      }
      try {
        const form = new FormData();
        form.append("file", f);
        form.append("section", section);
        const res = await fetch("/api/orgmis/upload", { method: "POST", body: form });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as UploadedFile;
        onAdd(data);
      } catch (e: any) {
        errs.push(`${f.name}: ${e.message || "upload failed"}`);
      }
    }
    if (errs.length) setErrors(errs);
    setUploading(false);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  }

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {title}
          {required && (
            <span className="text-[10px] font-bold uppercase text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
              Required
            </span>
          )}
          {fileList.length > 0 && (
            <span className="text-[10px] font-bold uppercase text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
              {fileList.length} file{fileList.length > 1 && "s"}
            </span>
          )}
        </span>
      }
      subtitle={description}
    >
      {/* File list (if any) */}
      {fileList.length > 0 && (
        <div className="space-y-2 mb-3">
          {fileList.map((file) => (
            <div
              key={file.id}
              className="flex items-start gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200"
            >
              <div className="w-9 h-9 rounded-lg bg-white border border-emerald-200 flex items-center justify-center flex-shrink-0">
                <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-900 text-sm truncate">
                  {file.filename}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {formatBytes(file.size)} • {new Date(file.uploadedAt).toLocaleTimeString()}
                </div>
              </div>
              <button
                onClick={() => onRemove(file.id)}
                className="text-slate-400 hover:text-red-600 p-1 rounded transition"
                aria-label="Remove file"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Drop zone — always visible so user can add more */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition",
          drag
            ? "border-brand-500 bg-brand-50"
            : "border-slate-300 hover:border-brand-500 hover:bg-slate-50",
          uploading && "opacity-50 pointer-events-none"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = ""; // reset so same file can be re-selected
          }}
        />
        {uploading ? (
          <div className="space-y-2">
            <div className="w-7 h-7 rounded-full border-2 border-brand-500 border-t-transparent animate-spin mx-auto" />
            <p className="text-sm text-slate-600">Uploading…</p>
          </div>
        ) : (
          <>
            {fileList.length === 0 ? (
              <UploadIcon className="w-7 h-7 text-slate-400 mx-auto mb-2" />
            ) : (
              <Plus className="w-6 h-6 text-slate-400 mx-auto mb-2" />
            )}
            <p className="font-medium text-slate-700 text-sm">
              {fileList.length === 0 ? (
                <>Drop files here or <span className="text-brand-700">browse</span></>
              ) : (
                <>Add more files — <span className="text-brand-700">drop or browse</span></>
              )}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              .xlsx or .xls — up to 20 MB each — multiple files OK
            </p>
          </>
        )}
      </div>

      {errors.length > 0 && (
        <div className="mt-3 space-y-1">
          {errors.map((err, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2"
            >
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{err}</span>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500 mt-3 italic">{examples}</p>
    </Card>
  );
}
