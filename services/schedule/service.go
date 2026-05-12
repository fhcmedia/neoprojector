package schedule

type Service struct{}

func New() *Service { return &Service{} }

func (*Service) ServiceName() string { return "schedule" }

func (*Service) Ping() string { return "schedule ok" }
