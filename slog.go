package main

import (
	"context"
	"log/slog"

	charmlog "github.com/charmbracelet/log"
)

type charmSlogHandler struct {
	logger *charmlog.Logger
	attrs  []slog.Attr
}

func newCharmSlogHandler(logger *charmlog.Logger) *charmSlogHandler {
	return &charmSlogHandler{logger: logger}
}

func (h *charmSlogHandler) Enabled(ctx context.Context, level slog.Level) bool {
	cl := h.logger
	switch {
	case level >= slog.LevelError:
		return cl.GetLevel() <= charmlog.ErrorLevel
	case level >= slog.LevelWarn:
		return cl.GetLevel() <= charmlog.WarnLevel
	case level >= slog.LevelInfo:
		return cl.GetLevel() <= charmlog.InfoLevel
	default:
		return cl.GetLevel() <= charmlog.DebugLevel
	}
}

func (h *charmSlogHandler) Handle(ctx context.Context, r slog.Record) error {
	var level charmlog.Level
	switch {
	case r.Level >= slog.LevelError:
		level = charmlog.ErrorLevel
	case r.Level >= slog.LevelWarn:
		level = charmlog.WarnLevel
	case r.Level >= slog.LevelInfo:
		level = charmlog.InfoLevel
	default:
		level = charmlog.DebugLevel
	}

	kv := make([]any, 0, len(h.attrs)*2+r.NumAttrs()*2)
	for _, a := range h.attrs {
		kv = append(kv, a.Key, a.Value.Any())
	}
	r.Attrs(func(a slog.Attr) bool {
		kv = append(kv, a.Key, a.Value.Any())
		return true
	})

	h.logger.Log(level, r.Message, kv...)
	return nil
}

func (h *charmSlogHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	if len(attrs) == 0 {
		return h
	}
	combined := make([]slog.Attr, len(h.attrs)+len(attrs))
	copy(combined, h.attrs)
	copy(combined[len(h.attrs):], attrs)
	return &charmSlogHandler{logger: h.logger, attrs: combined}
}

func (h *charmSlogHandler) WithGroup(name string) slog.Handler {
	return h
}
