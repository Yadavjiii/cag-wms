import { useState } from "react";
import { Download, Eye, File, FileArchive, FileSpreadsheet, FileText, Image as ImageIcon, X } from "lucide-react";
import { Attachment } from "../types";
import { downloadFile, viewUrl } from "../api/client";
import { canPreview, fileKind, fmtSize } from "../lib/format";

/**
 * One file, as a chip.
 *
 * The icon comes from the MIME type recorded at upload, not from the extension,
 * because a file named "report" is still a PDF. Previewable types open in a new
 * tab through an authenticated blob URL rather than a plain link: the download
 * route needs the bearer token, and an <a href> cannot carry one.
 */
export default function FileChip({
  file,
  onRemove,
  showUploader,
}: {
  file: Attachment;
  onRemove?: () => void;
  showUploader?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const kind = fileKind(file.mimeType, file.fileName);

  const Icon =
    kind === "image"
      ? ImageIcon
      : kind === "sheet"
        ? FileSpreadsheet
        : kind === "pdf" || kind === "doc" || kind === "text"
          ? FileText
          : kind === "archive"
            ? FileArchive
            : File;

  async function open() {
    setBusy(true);
    try {
      const url = await viewUrl(file.id);
      window.open(url, "_blank", "noopener");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await downloadFile(`/attachments/${file.id}/download`, file.fileName);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5 max-w-full border border-slate-200 bg-white rounded-md pl-2 pr-1.5 py-1 text-xs">
      <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      <span className="truncate max-w-[14rem] text-slate-700" title={file.fileName}>
        {file.fileName}
      </span>
      {file.size != null && <span className="text-slate-400 shrink-0 tabular-nums">{fmtSize(file.size)}</span>}
      {showUploader && file.uploadedBy && <span className="text-slate-400 shrink-0">{file.uploadedBy.fullName}</span>}

      {canPreview(file.mimeType) && (
        <button
          type="button"
          onClick={open}
          disabled={busy}
          title="Preview"
          className="text-slate-400 hover:text-indigo-700 shrink-0"
        >
          <Eye className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={save}
        disabled={busy}
        title="Download"
        className="text-slate-400 hover:text-indigo-700 shrink-0"
      >
        <Download className="w-3.5 h-3.5" />
      </button>
      {onRemove && (
        <button type="button" onClick={onRemove} title="Remove" className="text-slate-400 hover:text-rose-600 shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </span>
  );
}
