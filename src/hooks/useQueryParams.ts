import { useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export function useQueryParams() {
  const loc = useLocation();

  const queryParams = useMemo(() => {
    const obj: Record<string, string> = Object.fromEntries(
      new URLSearchParams(loc.search).entries(),
    );

    return obj;
  }, [loc.search]);

  return queryParams;
}

export function useQueryParam(
  param: string,
): [string | null, (a: string | null) => void] {
  const params = useQueryParams();
  const location = useLocation();
  const navigate = useNavigate();
  const currentValue = params[param] ?? null;

  const set = useCallback(
    (value: string | null) => {
      const parsed = new URLSearchParams(location.search);
      if (value) parsed.set(param, value);
      else parsed.delete(param);
      // When clearing the search, also preserve the current pathname
      // explicitly. Without this, navigate({ search: "" }) uses the
      // location at hook-render time, which may be stale if another
      // navigate() (e.g. path change) was called in the same tick but
      // hasn't been committed yet. This caused the episode-picker
      // overlay to revert the URL from /media/.../1/3 back to /media/.../1/1
      // when router.close() fired right after metaChange's navigate().
      navigate({
        pathname: location.pathname,
        search: parsed.toString(),
      });
    },
    [param, location.search, location.pathname, navigate],
  );

  return [currentValue, set];
}
