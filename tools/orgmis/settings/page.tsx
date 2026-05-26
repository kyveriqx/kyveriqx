"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@orgmis/lib/store";
import { Card, Button, Input, Textarea, Label, Badge } from "@orgmis/components/ui";
import { ArrowRight, Upload as UploadIcon, X, CheckCircle2 } from "lucide-react";

export default function SettingsPage() {
  const router = useRouter();
  const branding = useAppStore((s) => s.branding);
  const setBranding = useAppStore((s) => s.setBranding);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      alert("Logo must be under 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setBranding({ logoDataUrl: reader.result as string });
    reader.readAsDataURL(f);
  }

  function save() {
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Branding</h1>
          <p className="text-slate-500 mt-1">
            How your company appears on every report you generate.
          </p>
        </div>
        <Badge tone="brand">Step 1 of 4</Badge>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: form */}
        <div className="lg:col-span-2 space-y-6">
          <Card title="Identity" subtitle="Company name, logo, and core messaging.">
            <div className="space-y-5">
              <div>
                <Label htmlFor="companyName">Company name *</Label>
                <Input
                  id="companyName"
                  value={branding.companyName}
                  onChange={(e) => setBranding({ companyName: e.target.value })}
                  placeholder="e.g. Acme Furniture Pvt. Ltd."
                />
              </div>

              <div>
                <Label htmlFor="tagline">Tagline</Label>
                <Input
                  id="tagline"
                  value={branding.tagline}
                  onChange={(e) => setBranding({ tagline: e.target.value })}
                  placeholder="e.g. Crafting workspaces that inspire"
                />
              </div>

              <div>
                <Label htmlFor="vision">Vision statement</Label>
                <Textarea
                  id="vision"
                  value={branding.vision}
                  onChange={(e) => setBranding({ vision: e.target.value })}
                  placeholder="e.g. To be the leading furniture manufacturer empowering 1 million workplaces by 2030."
                  rows={3}
                />
                <p className="text-xs text-slate-500 mt-1">
                  Appears on the cover slide. Keep it under 200 characters for best fit.
                </p>
              </div>

              <div>
                <Label>Logo</Label>
                <div className="flex items-start gap-4">
                  <div className="w-28 h-28 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden">
                    {branding.logoDataUrl ? (
                      <img
                        src={branding.logoDataUrl}
                        alt=""
                        className="max-w-full max-h-full object-contain p-2"
                      />
                    ) : (
                      <UploadIcon className="w-7 h-7 text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/svg+xml"
                      onChange={handleLogoChange}
                      className="hidden"
                    />
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                        Choose file
                      </Button>
                      {branding.logoDataUrl && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setBranding({ logoDataUrl: null })}
                        >
                          <X className="w-3.5 h-3.5" />
                          Remove
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      PNG, JPG or SVG. Max 2 MB. Square (1:1) renders best.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card title="Reporting context" subtitle="Period and audience for this report.">
            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <Label htmlFor="period">Reporting period</Label>
                <Input
                  id="period"
                  value={branding.reportingPeriod}
                  onChange={(e) => setBranding({ reportingPeriod: e.target.value })}
                  placeholder="e.g. FY 2024-25"
                />
              </div>
              <div>
                <Label htmlFor="preparedFor">Prepared for</Label>
                <Input
                  id="preparedFor"
                  value={branding.preparedFor}
                  onChange={(e) => setBranding({ preparedFor: e.target.value })}
                  placeholder="e.g. Board of Directors"
                />
              </div>
            </div>
          </Card>

          <Card title="Brand colors" subtitle="Used on cover, headers, and KPI accents.">
            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <Label htmlFor="primary">Primary color</Label>
                <div className="flex items-center gap-3">
                  <input
                    id="primary"
                    type="color"
                    value={branding.primaryColor}
                    onChange={(e) => setBranding({ primaryColor: e.target.value })}
                    className="w-12 h-10 rounded-lg border border-slate-300 cursor-pointer"
                  />
                  <Input
                    value={branding.primaryColor}
                    onChange={(e) => setBranding({ primaryColor: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="accent">Accent color</Label>
                <div className="flex items-center gap-3">
                  <input
                    id="accent"
                    type="color"
                    value={branding.accentColor}
                    onChange={(e) => setBranding({ accentColor: e.target.value })}
                    className="w-12 h-10 rounded-lg border border-slate-300 cursor-pointer"
                  />
                  <Input
                    value={branding.accentColor}
                    onChange={(e) => setBranding({ accentColor: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Right: live preview */}
        <div className="lg:col-span-1">
          <div className="sticky top-24 space-y-4">
            <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">
              Cover preview
            </h3>
            <div
              className="rounded-xl overflow-hidden border border-slate-200 shadow-lg aspect-[16/9] relative text-white p-5"
              style={{
                background: `linear-gradient(135deg, ${branding.primaryColor} 0%, ${shade(
                  branding.primaryColor,
                  20
                )} 100%)`,
              }}
            >
              <div className="absolute top-0 left-0 right-0 h-1.5" style={{ background: branding.accentColor }} />
              {branding.logoDataUrl && (
                <img
                  src={branding.logoDataUrl}
                  alt=""
                  className="absolute top-4 right-4 w-14 h-14 object-contain rounded bg-white/10 p-1"
                />
              )}
              <div className="text-[10px] font-bold tracking-widest" style={{ color: branding.accentColor }}>
                ANNUAL BOARD REVIEW
              </div>
              <div className="text-2xl font-bold mt-3 leading-tight">
                {branding.companyName || "Your Company Name"}
              </div>
              <div className="text-xs italic opacity-90 mt-1">{branding.tagline || "Your tagline"}</div>
              <div className="absolute bottom-5 left-5 right-5 text-[10px]">
                <div className="opacity-80">Financial Performance & Strategic Outlook</div>
                <div className="font-medium mt-1" style={{ color: branding.accentColor }}>
                  {branding.reportingPeriod} • {branding.preparedFor}
                </div>
              </div>
            </div>

            <Button
              size="lg"
              onClick={() => {
                save();
                router.push("/tools/orgmis/upload");
              }}
              className="w-full"
            >
              Save & Continue
              <ArrowRight className="w-4 h-4" />
            </Button>
            {saved && (
              <div className="flex items-center gap-2 text-sm text-emerald-700">
                <CheckCircle2 className="w-4 h-4" /> Saved
              </div>
            )}
            <p className="text-xs text-slate-500 text-center">
              Branding is saved in your browser. It persists across visits.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function shade(hex: string, percent: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, ((num >> 16) & 0xff) + percent);
  const g = Math.min(255, ((num >> 8) & 0xff) + percent);
  const b = Math.min(255, (num & 0xff) + percent);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
