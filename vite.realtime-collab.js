const replaceRequired = (code, target, replacement, label) => {
  if (!code.includes(target)) throw new Error(`AMIMAPER realtime transform failed: ${label}`);
  return code.replace(target, replacement);
};

export const amimapRealtimeCollaborationPlugin = () => ({
  name: "amimap-realtime-collaboration",
  enforce: "pre",
  transform(source, id) {
    if (!id.endsWith("/src/main.jsx") && !id.endsWith("\\src\\main.jsx")) return null;
    let code = source;

    const block = [
      '',
      '  // ✅ 동일 data_file 사용자끼리 meters 상태/우선순위를 실시간 공유',
      '  useEffect(() => {',
      '    const dataFile = String(currentUser?.data_file || "").trim();',
      '    if (!loggedIn || !hasUsableDataFile(dataFile)) return;',
      '',
      '    let disposed = false;',
      '    let subscribedOnce = false;',
      '    const filter = `data_file=eq.${dataFile}`;',
      '',
      '    const applyRealtimeRow = (row) => {',
      '      if (disposed || !row || String(row?.data_file || "") !== dataFile) return;',
      '      const id = normalizeMeterId(row?.meter_id);',
      '      if (!id || !dataByMeterRef.current.has(id)) return;',
      '',
      '      const current = dataByMeterRef.current.get(id) || {};',
      '      const incoming = {',
      '        ...current,',
      '        ...row,',
      '        status: normalizeStatusValue(row?.status),',
      '        priority: normalizePriorityValue(row?.priority),',
      '      };',
      '',
      '      dataByMeterRef.current.set(id, incoming);',
      '      metersCacheRef.current.set(id, incoming);',
      '      setData((prev) =>',
      '        prev.map((item) =>',
      '          normalizeMeterId(item?.meter_id) === id',
      '            ? { ...item, status: incoming.status, priority: incoming.priority }',
      '            : item',
      '        )',
      '      );',
      '',
      '      const latest = new Map([[id, incoming]]);',
      '      updateMarkerColorsByMeterIds([id], latest);',
      '      updateMarkerPrioritiesByMeterIds([id], latest);',
      '    };',
      '',
      '    const syncCurrentFile = () => {',
      '      const ids = dataRef.current.map((item) => normalizeMeterId(item?.meter_id)).filter(Boolean);',
      '      if (ids.length > 0) fetchMetersStatusByIds(ids).catch(() => {});',
      '    };',
      '',
      '    const onVisibilityChange = () => {',
      '      if (document.visibilityState !== "visible") return;',
      '      syncCurrentFile();',
      '      fetchCustomMarkersFromDB(true).catch(() => {});',
      '    };',
      '    document.addEventListener("visibilitychange", onVisibilityChange);',
      '',
      '    const channel = supabase',
      '      .channel(`amimap-meters-${Date.now()}-${Math.random().toString(36).slice(2)}`)',
      '      .on(',
      '        "postgres_changes",',
      '        { event: "INSERT", schema: "public", table: "meters", filter },',
      '        (payload) => applyRealtimeRow(payload?.new)',
      '      )',
      '      .on(',
      '        "postgres_changes",',
      '        { event: "UPDATE", schema: "public", table: "meters", filter },',
      '        (payload) => applyRealtimeRow(payload?.new)',
      '      )',
      '      .subscribe((status) => {',
      '        if (status !== "SUBSCRIBED") return;',
      '        if (subscribedOnce) syncCurrentFile();',
      '        subscribedOnce = true;',
      '      });',
      '',
      '    return () => {',
      '      disposed = true;',
      '      document.removeEventListener("visibilitychange", onVisibilityChange);',
      '      try { supabase.removeChannel(channel); } catch {}',
      '    };',
      '  }, [loggedIn, currentUser?.data_file]);',
    ].join("\n");

    code = replaceRequired(
      code,
      '\n\n  // ✅ 현재 화면(bounds) 안에 있는 meter_id 전부 뽑기 (좌표 있는 것만)',
      `${block}\n\n  // ✅ 현재 화면(bounds) 안에 있는 meter_id 전부 뽑기 (좌표 있는 것만)`,
      "same data_file realtime"
    );

    return { code, map: null };
  },
});
