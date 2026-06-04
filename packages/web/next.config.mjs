const apiBase = process.env.HARNESS_API_BASE ?? "http://127.0.0.1:4000";

/** @type {import('next').NextConfig} */
export default {
  env: { HARNESS_API_BASE: apiBase },
};
