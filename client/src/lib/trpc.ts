import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../../../server/routers";

export const trpc = createTRPCReact<AppRouter>();

export const trpcClientConfig = { 
  links: [
    httpBatchLink({
      url: "/api/trpc",
      headers() {
        return { "x-client": "kdp-kids-book-studio" };
      },
    }),
  ],
};
