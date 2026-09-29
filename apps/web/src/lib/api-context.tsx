"use client";

import { createContext, useContext } from "react";
import { type Api, api } from "./api";

/** API mặc định là client thật; test truyền API giả qua Provider. */
export const ApiContext = createContext<Api>(api);
export const useApi = () => useContext(ApiContext);
