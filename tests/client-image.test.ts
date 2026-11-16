import { afterEach, describe, expect, it, vi } from "vitest";

import {
  uploadImageFile,
  type ImageUploadProgress,
} from "@/lib/client-image";
import { PNG_BYTES } from "./helpers/image-fixtures";

type FakeHandler = (xhr: FakeXMLHttpRequest, form: FormData) => void;

function successfulUpload(
  xhr: FakeXMLHttpRequest,
  _form: FormData,
): void {
  xhr.upload.onprogress?.({
    lengthComputable: true,
    loaded: 5,
    total: 10,
  });
  xhr.upload.onload?.();
  xhr.status = 201;
  xhr.responseText = JSON.stringify({ image: { id: "image-1" } });
  xhr.onload?.();
}

class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = [];
  static handler: FakeHandler = successfulUpload;

  open = vi.fn();
  send = vi.fn((form: FormData) => {
    this.form = form;
    FakeXMLHttpRequest.handler(this, form);
  });
  timeout = 0;
  status = 0;
  responseText = "";
  form: FormData | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onload: (() => void) | null = null;
  upload: {
    onprogress:
      | ((event: {
          lengthComputable: boolean;
          loaded: number;
          total: number;
        }) => void)
      | null;
    onload: (() => void) | null;
  } = { onprogress: null, onload: null };

  constructor() {
    FakeXMLHttpRequest.instances.push(this);
  }
}

function installFakeXhr(): typeof FakeXMLHttpRequest {
  FakeXMLHttpRequest.instances = [];
  FakeXMLHttpRequest.handler = successfulUpload;
  vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
  return FakeXMLHttpRequest;
}

function imageFile(): File {
  return new File([new Uint8Array(PNG_BYTES)], "pixel.png", {
    type: "image/png",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadImageFile", () => {
  it("sends multipart bytes with progress phases and returns the image id", async () => {
    const Fake = installFakeXhr();
    const progress: ImageUploadProgress[] = [];

    const uploaded = await uploadImageFile(imageFile(), "note", {
      onProgress: (event) => progress.push(event),
    });

    expect(uploaded).toMatchObject({
      imageId: "image-1",
      contentType: "image/png",
    });
    expect(progress).toEqual([
      { phase: "uploading", fraction: 0.5 },
      { phase: "processing", fraction: null },
    ]);

    const xhr = Fake.instances[0]!;
    expect(xhr.open).toHaveBeenCalledWith("POST", "/api/images");
    expect(xhr.form?.get("kind")).toBe("note");
    expect(xhr.form?.get("file")).toBeInstanceOf(File);
  });

  it("surfaces premium API errors with their status", async () => {
    const Fake = installFakeXhr();
    Fake.handler = (xhr) => {
      xhr.upload.onload?.();
      xhr.status = 402;
      xhr.responseText = JSON.stringify({
        error: "An active subscription is required.",
      });
      xhr.onload?.();
    };

    await expect(uploadImageFile(imageFile(), "note")).rejects.toMatchObject({
      status: 402,
      message: "An active subscription is required.",
    });
  });

  it("reports a connection failure as a retryable storage error", async () => {
    const Fake = installFakeXhr();
    Fake.handler = (xhr) => {
      xhr.onerror?.();
    };

    await expect(uploadImageFile(imageFile(), "note")).rejects.toMatchObject({
      status: 502,
    });
  });
});
