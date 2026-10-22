"use client";

import { useEffect, useState } from "react";
import {
  getAuthCapabilities,
  type AuthCapabilities,
} from "../lib/auth-capabilities";

const fallback: AuthCapabilities = {
  emailPassword: true,
  providers: { google: false, github: false },
};

export function useAuthCapabilities(): AuthCapabilities {
  const [capabilities, setCapabilities] = useState(fallback);

  useEffect(() => {
    let cancelled = false;
    void getAuthCapabilities().then((next) => {
      if (!cancelled) setCapabilities(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return capabilities;
}
