package songs

type Service struct{}

func New() *Service { return &Service{} }

func (*Service) ServiceName() string { return "songs" }

func (*Service) Ping() string { return "songs ok" }
