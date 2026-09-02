export const SEQUENCE_VERSION_KEY = "sequencing_version";

export const SEQUENCE_VERSION = {
  V1: "V1",
  V2: "V2",
};

export const normalizeSequenceVersion = (value) =>
  String(value || "").trim().toUpperCase() === SEQUENCE_VERSION.V2
    ? SEQUENCE_VERSION.V2
    : SEQUENCE_VERSION.V1;

export const getSequenceVersion = () => {
  const url = new URL(window.location.href);
  const urlVersion = url.searchParams.get("version");

  if (urlVersion) {
    const normalizedVersion = normalizeSequenceVersion(urlVersion);

    localStorage.setItem(
      SEQUENCE_VERSION_KEY,
      normalizedVersion,
    );

    return normalizedVersion;
  }

  return normalizeSequenceVersion(
    localStorage.getItem(SEQUENCE_VERSION_KEY),
  );
};

export const setSequenceVersion = (version) => {
  const normalizedVersion = normalizeSequenceVersion(version);

  localStorage.setItem(
    SEQUENCE_VERSION_KEY,
    normalizedVersion,
  );

  const url = new URL(window.location.href);

  url.searchParams.set(
    "version",
    normalizedVersion.toLowerCase(),
  );

  window.location.assign(url.toString());
};

export const isSequenceV2 = () =>
  getSequenceVersion() === SEQUENCE_VERSION.V2;
