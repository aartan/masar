import { api } from "@/lib/client-api";
import type { LabelColor } from "@/lib/constants";
import type { Label } from "@/lib/types";

export type LabelDraft = {
  name: string;
  color: LabelColor;
};

export async function createLabel(
  boardId: string,
  draft: LabelDraft,
): Promise<Label> {
  const { label } = await api<{ label: Label }>(
    `/api/boards/${boardId}/labels`,
    {
      method: "POST",
      body: JSON.stringify(draft),
    },
  );
  return label;
}

export async function updateLabel(
  labelId: string,
  draft: LabelDraft,
): Promise<Label> {
  const { label } = await api<{ label: Label }>(`/api/labels/${labelId}`, {
    method: "PATCH",
    body: JSON.stringify(draft),
  });
  return label;
}

export async function deleteLabel(labelId: string): Promise<void> {
  await api(`/api/labels/${labelId}`, { method: "DELETE" });
}
