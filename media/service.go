package media

type Service struct{}

func New() *Service { return &Service{} }

func (*Service) ServiceName() string { return "media" }

func (*Service) Ping() string { return "media ok" }
