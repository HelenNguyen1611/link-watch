"use client";

import { createContext, useContext } from "react";
import { type Api, api } from "./api";

/** Defaults to the real client; tests pass a fake API through the Provider. */
export const ApiContext = createContext<Api>(api);
export const useApi = () => useContext(ApiContext);
